import { clamp } from "./util/clamp";

export class DynamicAudioNode {
    constructor(
        public gain: GainNode,
        public audio: AudioBufferSourceNode,
        public rpm: number = 1000,
        public volume: number = 1.0,
    ) {}
}

export type AudioSource = {
    source: string;
    rpm: number;
    volume?: number;
}

export class AudioManager {

    ctx: AudioContext | null = null;
    volume: GainNode | null = null;

    samples: Record<string, DynamicAudioNode> = {}
    private initId = 0;

    async init(sources: Record<string, AudioSource>) {
        if (this.ctx)
            return;

        const initId = ++this.initId;
        const ctx = new AudioContext();
        const volume = ctx.createGain();
        volume.gain.value = 0.5;

        const samples: Record<string, DynamicAudioNode> = {};

        try {
            for (const key in sources) {
                if (initId !== this.initId) {
                    throw new Error('AudioManager init aborted');
                }
                samples[key] = await this.createSample(ctx, volume, sources[key]);
            }
        } catch (error) {
            for (const key in samples) {
                this.teardownSample(samples[key]);
            }
            try { volume.disconnect(); } catch { /* ignore */ }
            void ctx.close();
            if (initId === this.initId) {
                this.ctx = null;
                this.volume = null;
                this.samples = {};
            }
            throw error;
        }

        if (initId !== this.initId) {
            for (const key in samples) {
                this.teardownSample(samples[key]);
            }
            try { volume.disconnect(); } catch { /* ignore */ }
            void ctx.close();
            return;
        }

        this.ctx = ctx;
        this.volume = volume;
        this.samples = samples;

        if (this.ctx.state === 'suspended')
            await this.ctx.resume();
    }

    private async createSample(
        ctx: AudioContext,
        master: GainNode,
        source: AudioSource,
    ): Promise<DynamicAudioNode> {
        const audio = ctx.createBufferSource();
        const url = source.source.split('/').map(encodeURIComponent).join('/');
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load audio: ${source.source} (${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        audio.buffer = audioBuffer;
        audio.loop = true;

        const gain = ctx.createGain();
        gain.gain.value = 0.0;

        audio
            .connect(gain)
            .connect(master)
            .connect(ctx.destination);

        audio.start();

        return new DynamicAudioNode(
            gain,
            audio,
            source.rpm,
            source.volume ?? 1.0
        )
    }

    private teardownSample(sample: DynamicAudioNode) {
        try { sample.audio.stop(); } catch { /* already stopped */ }
        try { sample.audio.disconnect(); } catch { /* ignore */ }
        try { sample.gain.disconnect(); } catch { /* ignore */ }
    }

    setMasterVolume(value: number) {
        if (this.volume) {
            this.volume.gain.value = clamp(value, 0, 1);
        }
    }

    muteAll() {
        for (const key in this.samples) {
            this.samples[key].gain.gain.value = 0;
        }
    }

    static crossFade(value: number, start: number, end: number) {

        /* Equal power crossfade */
        const x = clamp((value - start) / (end - start), 0, 1);
        const gain1 = Math.cos((1.0 - x) * 0.5 * Math.PI);
        const gain2 = Math.cos(x * 0.5 * Math.PI);

        return {
            gain1, gain2
        }
    }

    public dispose() {
        this.initId++;
        for (const key in this.samples) {
            this.teardownSample(this.samples[key]);
        }
        this.samples = {};

        if (this.volume) {
            try { this.volume.disconnect(); } catch { /* ignore */ }
            this.volume = null;
        }

        if (this.ctx) {
            void this.ctx.close();
            this.ctx = null;
        }
    }
}
