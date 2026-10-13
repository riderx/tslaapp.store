/// <reference lib="es2020" />
import { ENGINE_SYNTH_PROCESSOR, type EngineSynthOptions, type EngineSynthSpec } from './types';

/* AudioWorkletGlobalScope is not part of the DOM lib */
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor(options?: unknown);
}

const TAU = Math.PI * 2;
const SPEED_OF_SOUND = 343;

/* RBJ biquad, transposed direct form II */
class Biquad {
    b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
    z1 = 0; z2 = 0;

    lowpass(freq: number, q: number) {
        const w = TAU * Math.min(freq, sampleRate * 0.45) / sampleRate;
        const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = (1 - cos) / 2 / a0;
        this.b1 = (1 - cos) / a0;
        this.b2 = this.b0;
        this.a1 = -2 * cos / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    highpass(freq: number, q: number) {
        const w = TAU * freq / sampleRate;
        const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = (1 + cos) / 2 / a0;
        this.b1 = -(1 + cos) / a0;
        this.b2 = this.b0;
        this.a1 = -2 * cos / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    /* Constant 0 dB peak gain */
    bandpass(freq: number, q: number) {
        const w = TAU * Math.min(freq, sampleRate * 0.45) / sampleRate;
        const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        this.b0 = alpha / a0;
        this.b1 = 0;
        this.b2 = -alpha / a0;
        this.a1 = -2 * cos / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    process(x: number) {
        const y = this.b0 * x + this.z1;
        this.z1 = this.b1 * x - this.a1 * y + this.z2;
        this.z2 = this.b2 * x - this.a2 * y;
        return y;
    }
}

class DelayLine {
    buf: Float32Array;
    w = 0;

    constructor(maxSamples: number) {
        this.buf = new Float32Array(Math.max(2, Math.ceil(maxSamples) + 2));
    }

    push(x: number) {
        this.buf[this.w] = x;
        this.w = (this.w + 1) % this.buf.length;
    }

    /* Read `d` samples back (fractional, linear) */
    read(d: number) {
        const len = this.buf.length;
        const pos = this.w - 1 - d;
        const i = Math.floor(pos);
        const f = pos - i;
        const a = this.buf[((i % len) + len) % len];
        const b = this.buf[(((i + 1) % len) + len) % len];
        return a + (b - a) * f;
    }
}

type Pulse = {
    t: number;     // samples since ignition, negative while still in the runner
    amp: number;
    tau: number;   // pressure rise time in samples
    noise: number;
};

const onePole = (seconds: number) => 1 - Math.exp(-1 / (sampleRate * seconds));

class EngineSynthProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
            { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'gearRatio', defaultValue: 0, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
            /* Key position: fuel and spark on, starter motor engaged */
            { name: 'ignition', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'starter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        ];
    }

    spec: EngineSynthSpec;
    idle: number;
    limiter: number;

    /* Smoothed controls */
    rpm: number;
    load = 0;
    cut = 0;
    gearRatio = 0;
    ignition = 0;
    starter = 0;

    /* Crank */
    crank = 0;
    firingOrder: number[];
    nextEvent = 0;
    pulses: Pulse[];
    runnerSamples: number[];

    /* Exhaust */
    banks: number;
    bankBus: Float32Array;
    bankLines: DelayLine[];
    bankDelaySamples: number[];
    exhaustLine: DelayLine;
    exhaustDelay: number;
    muffler = new Biquad();
    mufflerCutoff = 0;
    resonators: { filter: Biquad; gain: number }[];

    /* Block / intake / valvetrain */
    blockHp = new Biquad();
    blockLp = new Biquad();
    intakeBp = new Biquad();
    mechBp = new Biquad();
    pulseEnv = 0;

    /* Overrun */
    overrun = 0;
    pops: Pulse[] = [];
    popLp = new Biquad();

    /* Turbo */
    spool = 0;
    whistlePhase = 0;
    blowoff = 0;
    blowoffBp = new Biquad();

    /* Gearbox */
    whinePhase = 0;

    /* Starter motor */
    starterPhase = 0;
    starterBp = new Biquad();

    /* Exhaust cooling down after shutdown: sparse metallic ticks */
    cooling = 0;
    tickEnv = 0;
    tickBp = new Biquad();

    /* Output */
    dcBlock = new Biquad();
    kRpm = onePole(0.025);
    kLoad = onePole(0.06);
    kSpool = onePole(0.7);
    kMuffler = onePole(0.08);
    blockCounter = 0;

    constructor(options: { processorOptions: EngineSynthOptions }) {
        super(options);
        const { spec, idle, limiter } = options.processorOptions;
        this.spec = spec;
        this.idle = idle;
        this.limiter = limiter;
        this.rpm = 0;

        const order = spec.firing.map((_, i) => i).sort((a, b) => spec.firing[a].angle - spec.firing[b].angle);
        this.firingOrder = order;
        this.pulses = spec.firing.map(() => ({ t: 1e9, amp: 0, tau: 1, noise: 0 }));
        this.runnerSamples = spec.firing.map(f => (f.runnerMs ?? 0) * sampleRate / 1000);

        this.banks = Math.max(1, ...spec.firing.map(f => f.bank + 1));
        this.bankBus = new Float32Array(this.banks);
        this.bankDelaySamples = Array.from({ length: this.banks }, (_, b) => (spec.bankDelayMs[b] ?? 0) * sampleRate / 1000);
        this.bankLines = this.bankDelaySamples.map(d => new DelayLine(d + 4));

        this.exhaustDelay = spec.exhaustLength / SPEED_OF_SOUND * sampleRate;
        this.exhaustLine = new DelayLine(this.exhaustDelay + 4);

        this.resonators = spec.resonances.map(r => ({ filter: new Biquad().bandpass(r.freq, r.q), gain: r.gain }));
        this.mufflerCutoff = spec.muffler.closed;
        this.muffler.lowpass(this.mufflerCutoff, 0.8);

        this.blockHp.highpass(140, 0.7);
        this.blockLp.lowpass(3200, 0.7);
        this.mechBp.bandpass(3800, 1.6);
        this.popLp.lowpass(2600, 0.7);
        this.blowoffBp.bandpass(2400, 1.2);
        this.dcBlock.highpass(32, 0.7);
        this.starterBp.bandpass(1400, 0.9);
        this.tickBp.bandpass(4200, 6);

        this.crank = order.length ? spec.firing[order[0]].angle - 1 : 0;
    }

    /* One combustion (or a cut one) in cylinder `i` */
    ignite(i: number) {
        const spec = this.spec;
        const rpmNorm = Math.min(1, this.rpm / this.limiter);
        const interval = 120 / Math.max(this.rpm, 300) / spec.firing.length * sampleRate;
        const tau = Math.min(Math.max(interval * spec.pulseWidth * 0.5, 0.00035 * sampleRate), 0.009 * sampleRate);
        const bias = spec.firing[i].bias ?? 0;
        /* Pop rates are per second, spread over however many combustions that is */
        const perFiring = 1 / (Math.max(this.rpm, 300) / 120 * spec.firing.length);
        const jitter = (Math.random() * 2 - 1) * (0.06 + 0.12 * (1 - rpmNorm));

        let amp: number;
        if (this.ignition < 0.5) {
            /* No fuel, no spark: compression only (cranking, spinning down) */
            amp = 0.05;
        } else if (this.cut > 0.5 && Math.random() < 0.85) {
            /* Ignition cut: rev limiter or shift */
            amp = 0.04;
            if (Math.random() < 5 * spec.crackle * perFiring) this.pop(0.5 + Math.random() * 0.5);
        } else if (this.load < 0.06 && this.rpm > this.idle * 1.4) {
            /* Overrun: injection cut, only pumping, and the line crackles */
            amp = 0.07;
            if (Math.random() < 9 * spec.crackle * this.overrun * perFiring) this.pop(0.3 + 0.7 * Math.random() * this.overrun);
        } else {
            amp = 0.2 + 0.8 * Math.pow(this.load, 0.8);
        }

        amp *= (1 + bias + jitter) * (0.65 + 0.35 * rpmNorm);

        const p = this.pulses[i];
        p.t = -this.runnerSamples[i];
        p.amp = amp;
        p.tau = tau;
        p.noise = amp * spec.roughness * (0.5 + 0.5 * this.load);
    }


    /* Afterfire in the exhaust line, a few ms to a few tens of ms later */
    pop(amp: number) {
        if (this.pops.length > 6) return;
        this.pops.push({
            t: -Math.random() * 0.03 * sampleRate,
            amp,
            tau: (0.0008 + Math.random() * 0.0012) * sampleRate,
            noise: amp * 1.4,
        });
    }

    updateFilters() {
        const spec = this.spec;
        const rpmNorm = Math.min(1, this.rpm / this.limiter);
        const open = this.load * Math.min(1, rpmNorm * 1.6);
        const target = spec.muffler.closed + (spec.muffler.open - spec.muffler.closed) * open;
        this.mufflerCutoff += (target - this.mufflerCutoff) * Math.min(1, this.kMuffler * 128);
        this.muffler.lowpass(this.mufflerCutoff, 0.8);
        this.intakeBp.bandpass(250 + this.rpm * 0.12, 0.9);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) {
        const out = outputs[0];
        if (!out || out.length === 0) return true;
        const left = out[0];
        const spec = this.spec;

        const rpmTarget = params.rpm[0];
        const loadTarget = params.load[0];
        this.cut = params.cut[0];
        const ignition = params.ignition[0];
        this.starter = params.starter[0];
        /* Key off after the engine ran: the line ticks while it cools */
        if (this.ignition > 0.5 && ignition < 0.5 && this.rpm > this.idle * 0.5) this.cooling = 1;
        if (ignition > 0.5) this.cooling = 0;
        this.ignition = ignition;
        this.cooling *= Math.exp(-left.length / (sampleRate * 9));
        const gearTarget = params.gearRatio[0];

        /* Lift-off at speed arms the overrun crackle, which fades after a few seconds */
        if (loadTarget < 0.06 && this.load > 0.3 && this.rpm > this.idle * 2.5) this.overrun = 1;
        this.overrun *= Math.exp(-left.length / (sampleRate * 2.2));
        if (loadTarget > 0.1) this.overrun = 0;

        if (spec.turbo && loadTarget < 0.12 && this.spool > 0.45 && this.blowoff < 0.05) {
            this.blowoff = this.spool;
            this.spool *= 0.4;
        }

        if ((this.blockCounter++ & 1) === 0) this.updateFilters();

        const events = this.firingOrder;
        const nEvents = events.length;
        const firing = spec.firing;
        const pulses = this.pulses;
        const bankBus = this.bankBus;
        const blowoffDecay = Math.exp(-1 / (sampleRate * 0.35));
        const tickDecay = Math.exp(-1 / (sampleRate * 0.004));
        const turbo = spec.turbo;

        for (let s = 0; s < left.length; s++) {
            this.rpm += (rpmTarget - this.rpm) * this.kRpm;
            this.load += (loadTarget - this.load) * this.kLoad;
            this.gearRatio += (gearTarget - this.gearRatio) * this.kLoad;

            const rpm = Math.max(this.rpm, 0);
            const rpmNorm = Math.min(1, rpm / this.limiter);

            /* Advance the crank and fire every event it crosses */
            this.crank += rpm / 60 * 360 / sampleRate;
            if (nEvents > 0) {
                for (let guard = 0; guard < nEvents; guard++) {
                    const ev = events[this.nextEvent];
                    if (this.crank < firing[ev].angle) break;
                    this.ignite(ev);
                    this.nextEvent = (this.nextEvent + 1) % nEvents;
                    if (this.nextEvent === 0) this.crank -= 720;
                }
            }

            /* Combustion pressure pulses, summed per bank */
            bankBus.fill(0);
            let block = 0;
            for (let i = 0; i < pulses.length; i++) {
                const p = pulses[i];
                if (p.t > p.tau * 10) continue;
                p.t++;
                if (p.t < 0) continue;
                const x = p.t / p.tau;
                const env = x * Math.exp(1 - x);
                const v = p.amp * env + p.noise * Math.exp(-x * 0.6) * (Math.random() * 2 - 1);
                bankBus[firing[i].bank] += v;
                block += v;
            }

            let collector = 0;
            for (let b = 0; b < this.banks; b++) {
                const line = this.bankLines[b];
                line.push(bankBus[b]);
                collector += line.read(this.bankDelaySamples[b]);
            }

            /* Exhaust line: travel time, muffler, fixed resonances */
            this.exhaustLine.push(collector);
            const atPipe = this.exhaustLine.read(this.exhaustDelay);
            let exhaust = this.muffler.process(atPipe);
            for (let r = 0; r < this.resonators.length; r++) {
                exhaust += this.resonators[r].filter.process(atPipe) * this.resonators[r].gain;
            }

            /* Afterfire pops happen in the line, past the muffler's dampening */
            let pops = 0;
            for (let k = this.pops.length - 1; k >= 0; k--) {
                const p = this.pops[k];
                p.t++;
                if (p.t < 0) continue;
                const x = p.t / p.tau;
                pops += p.amp * x * Math.exp(1 - x) + p.noise * Math.exp(-x * 0.35) * (Math.random() * 2 - 1);
                if (x > 14) this.pops.splice(k, 1);
            }
            exhaust += this.popLp.process(pops);

            /* Block: combustion heard through the firewall, intake, valvetrain */
            const blockOut = this.blockLp.process(this.blockHp.process(block));
            this.pulseEnv += (Math.abs(block) - this.pulseEnv) * 0.002;
            const noise = Math.random() * 2 - 1;
            const spinning = Math.min(1, rpm / 400);
            const intake = this.intakeBp.process(noise) * spec.intake * this.load * (0.3 + rpmNorm) * spinning;
            const mech = this.mechBp.process(noise) * spec.mechanical * (0.2 + this.pulseEnv * 2) * (0.3 + rpmNorm) * spinning;

            /* Starter: pinion whine rising with crank speed, plus gear grind */
            let starter = 0;
            if (this.starter > 0.001) {
                this.starterPhase += (160 + rpm * 1.3) / sampleRate;
                if (this.starterPhase > 1) this.starterPhase -= 1;
                starter = (Math.tanh(Math.sin(TAU * this.starterPhase) * 3) * 0.09 + this.starterBp.process(noise) * 0.06) * this.starter;
            }

            let tick = 0;
            if (this.cooling > 0.01) {
                if (Math.random() < this.cooling * 3 / sampleRate) this.tickEnv = 0.12 + Math.random() * 0.25 * this.cooling;
                tick = this.tickBp.process(noise) * this.tickEnv;
                this.tickEnv *= tickDecay;
            }

            /* Turbo whistle follows boost, blow-off valve on lift */
            let turboOut = 0;
            if (turbo) {
                const boostTarget = this.load * Math.min(1, rpm / (this.limiter * 0.55));
                this.spool += (boostTarget - this.spool) * this.kSpool;
                this.whistlePhase += turbo.freq * (0.25 + 0.75 * this.spool) / sampleRate;
                if (this.whistlePhase > 1) this.whistlePhase -= 1;
                turboOut = Math.sin(TAU * this.whistlePhase) * turbo.whistle * this.spool * this.spool;
                if (this.blowoff > 0.001) {
                    turboOut += this.blowoffBp.process(noise) * turbo.blowoff * this.blowoff;
                    this.blowoff *= blowoffDecay;
                }
            }

            /* Gear mesh whine, only with a gear engaged */
            this.whinePhase += rpm / 60 * spec.whineTeeth / sampleRate;
            if (this.whinePhase > 1) this.whinePhase -= 1;
            const whine = this.gearRatio > 0.05
                ? Math.sin(TAU * this.whinePhase) * spec.whine * rpmNorm * (0.4 + 0.6 * this.load)
                : 0;

            let y = exhaust * spec.exhaustMix + blockOut * spec.blockMix + intake + mech + turboOut + whine + starter + tick;
            y = this.dcBlock.process(y) * spec.gain;
            left[s] = Math.tanh(y);
        }

        for (let c = 1; c < out.length; c++) out[c].set(left);
        return true;
    }
}

registerProcessor(ENGINE_SYNTH_PROCESSOR, EngineSynthProcessor);
