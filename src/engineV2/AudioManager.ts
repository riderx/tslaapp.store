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

    async init(sources: Record<string, AudioSource>) {
        if (this.ctx)
            return;

        this.ctx = new AudioContext();
        this.volume = this.ctx.createGain();
        this.volume.gain.value = 0.5;

        for (const key in sources) {
            this.samples[key] = await this.add(sources[key]);
        }
        
        if (this.ctx.state === 'suspended')
            await this.ctx.resume();
    }

    async add(source: AudioSource): Promise<DynamicAudioNode> {
        if (!this.ctx || !this.volume) {
            throw new Error('AudioManager not initialized');
        }

        const audio = this.ctx.createBufferSource();
        const url = source.source.split('/').map(encodeURIComponent).join('/');
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load audio: ${source.source} (${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
        audio.buffer = audioBuffer;
        audio.loop = true;

        const gain = this.ctx.createGain();
        gain.gain.value = 0.0;

        audio
            .connect(gain)
            .connect(this.volume)
            .connect(this.ctx.destination);

        audio.start();

        return new DynamicAudioNode(
            gain,
            audio,
            source.rpm,
            source.volume ?? 1.0
        )
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
        this.muteAll();
        if (this.ctx) {
            void this.ctx.close();
            this.ctx = null;
            this.volume = null;
            this.samples = {};
        }
    }
}
