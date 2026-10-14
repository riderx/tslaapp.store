import { clamp } from "./util/clamp";
import { ENGINE_SYNTH_PROCESSOR, type EngineSynthOptions } from "./synth/types";
import workletUrl from "./synth/engineSynth.worklet.ts?worker&url";

export type EngineSoundState = {
    rpm: number;
    load: number;
    cut: boolean;
    gearRatio: number;
    ignition: boolean;
    starter: boolean;
}

/**
 * Real-time engine voice: one AudioWorklet synthesizing every combustion,
 * driven by the physics model. No samples are loaded.
 */
export class AudioManager {

    ctx: AudioContext | null = null;
    volume: GainNode | null = null;
    node: AudioWorkletNode | null = null;
    private bassShelf: BiquadFilterNode | null = null;
    private bassCut: BiquadFilterNode | null = null;

    private initId = 0;

    async init(options: EngineSynthOptions) {
        if (this.ctx)
            return;

        const initId = ++this.initId;
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        const volume = ctx.createGain();
        volume.gain.value = 0.5;

        try {
            await ctx.audioWorklet.addModule(workletUrl);
            if (initId !== this.initId)
                throw new Error('AudioManager init aborted');

            const node = new AudioWorkletNode(ctx, ENGINE_SYNTH_PROCESSOR, {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: options,
            });
            /* Bass protection for cars without a subwoofer, see setSubwoofer() */
            const bassShelf = ctx.createBiquadFilter();
            bassShelf.type = 'lowshelf';
            bassShelf.frequency.value = 160;
            const bassCut = ctx.createBiquadFilter();
            bassCut.type = 'highpass';
            bassCut.Q.value = 0.7;
            node.connect(bassShelf).connect(bassCut).connect(volume).connect(ctx.destination);

            this.ctx = ctx;
            this.volume = volume;
            this.node = node;
            this.bassShelf = bassShelf;
            this.bassCut = bassCut;
            this.setSubwoofer(true);
        } catch (error) {
            try { volume.disconnect(); } catch { /* ignore */ }
            void ctx.close();
            if (initId !== this.initId)
                return;
            throw error;
        }
    }

    update(state: EngineSoundState) {
        if (!this.node || !this.ctx) return;
        const p = this.node.parameters;
        p.get('rpm')!.value = Number.isFinite(state.rpm) ? Math.max(0, state.rpm) : 0;
        p.get('load')!.value = Number.isFinite(state.load) ? clamp(state.load, 0, 1) : 0;
        p.get('cut')!.value = state.cut ? 1 : 0;
        p.get('gearRatio')!.value = Math.max(0, state.gearRatio);
        p.get('ignition')!.value = state.ignition ? 1 : 0;
        p.get('starter')!.value = state.starter ? 1 : 0;
    }

    /* Door speakers alone can't take the low end: shelve it and cut the sub-bass */
    setSubwoofer(present: boolean) {
        if (!this.bassShelf || !this.bassCut) return;
        this.bassShelf.gain.value = present ? 0 : -9;
        this.bassCut.frequency.value = present ? 20 : 70;
    }

    /* `fadeSeconds` ramps instead of jumping (switching sound with the engine on) */
    setMasterVolume(value: number, fadeSeconds = 0) {
        if (!this.volume || !this.ctx) return;
        const gain = this.volume.gain;
        const target = clamp(value, 0, 1);
        const now = this.ctx.currentTime;
        gain.cancelScheduledValues(now);
        if (fadeSeconds > 0) {
            gain.setValueAtTime(gain.value, now);
            gain.linearRampToValueAtTime(target, now + fadeSeconds);
        } else {
            gain.setValueAtTime(target, now);
        }
    }

    public dispose() {
        this.initId++;

        if (this.node) {
            try { this.node.disconnect(); } catch { /* ignore */ }
            this.node = null;
        }

        for (const filter of [this.bassShelf, this.bassCut]) {
            try { filter?.disconnect(); } catch { /* ignore */ }
        }
        this.bassShelf = null;
        this.bassCut = null;

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
