import { Drivetrain } from "./Drivetrain"
import { Engine } from "./Engine"
import type { EngineSynthSpec, FiringEvent } from "./synth/types"

export type EngineConfiguration = {
    label: string
    subtitle: string
    engine: Partial<Engine>
    /* gears + final_drive set road speed -> RPM when driving */
    drivetrain: Partial<Drivetrain>,
    /* Driven tire rolling radius in meters */
    wheelRadius: number
    synth: EngineSynthSpec
}

/* Evenly spaced combustions over the 720° cycle */
const evenFiring = (
    cylinders: number,
    banks: number[] = [],
    runnerMs: number[] = [],
    bias: number[] = [],
): FiringEvent[] =>
    Array.from({ length: cylinders }, (_, i) => ({
        angle: (720 / cylinders) * i,
        bank: banks[i] ?? 0,
        runnerMs: runnerMs[i] ?? 0,
        bias: bias[i] ?? 0,
    }))

// https://www.motormatchup.com/catalog/BAC/Mono/2020/Base
// 2.5 NA inline four, 180° even firing, short race headers
export const bac_mono: EngineConfiguration = {
    label: 'BAC Mono',
    subtitle: '2.5 inline-4 · naturally aspirated',
    engine: {
        limiter: 9000,
        soft_limiter: 8950,
        limiter_ms: 0,
        inertia: 1.0,
    },
    drivetrain: {
        shiftTime: 50,
        damping: 16,
        /* Hewland 6-speed sequential (approximate), ~270 km/h at the limiter in 6th */
        gears: [2.92, 2.12, 1.67, 1.38, 1.18, 1.03],
        final_drive: 3.75,
    },
    wheelRadius: 0.318, // 255/40 R17
    synth: {
        firing: evenFiring(4, [], [0, 0.12, 0.05, 0.18], [0.04, -0.03, 0.02, -0.04]),
        bankDelayMs: [0],
        exhaustLength: 2.2,
        pulseWidth: 0.42,
        roughness: 0.35,
        resonances: [
            { freq: 140, q: 2.5, gain: 0.5 },
            { freq: 620, q: 4, gain: 0.25 },
            { freq: 1850, q: 5, gain: 0.08 },
        ],
        muffler: { closed: 900, open: 4200 },
        exhaustMix: 1.0,
        blockMix: 0.35,
        intake: 0.12,
        mechanical: 0.04,
        crackle: 0.7,
        whineTeeth: 22,
        whine: 0.025,
        gain: 1.2,
    },
}

// Ferrari F136 4.5 flat-plane V8: banks alternate on every combustion
export const ferr_458: EngineConfiguration = {
    label: 'Ferrari 458',
    subtitle: '4.5 flat-plane V8 · 8,900 rpm',
    engine: {
        limiter: 8900,
        soft_limiter: 8800,
        limiter_ms: 0,
        inertia: 0.8
    },
    drivetrain: {
        shiftTime: 10,
        damping: 6,
        /* Getrag 7DCL750 dual-clutch, top speed in 6th */
        gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69],
        final_drive: 4.44,
    },
    wheelRadius: 0.357, // 295/35 R20
    synth: {
        firing: evenFiring(8, [0, 1, 0, 1, 0, 1, 0, 1], [0, 0.04, 0.08, 0.02, 0.06, 0.1, 0.03, 0.07], [0.02, -0.02, 0.01, -0.01, 0.03, -0.03, 0.0, 0.01]),
        bankDelayMs: [0, 0.35],
        exhaustLength: 3.4,
        pulseWidth: 0.4,
        roughness: 0.28,
        resonances: [
            { freq: 180, q: 2, gain: 0.45 },
            { freq: 760, q: 3.5, gain: 0.35 },
            { freq: 2300, q: 5, gain: 0.12 },
        ],
        muffler: { closed: 1100, open: 5200 },
        exhaustMix: 1.0,
        blockMix: 0.3,
        intake: 0.14,
        mechanical: 0.05,
        crackle: 0.5,
        whineTeeth: 24,
        whine: 0.02,
        gain: 1.0,
    },
}

// BMW M88 3.5 inline six, 120° even firing, straight-pipe race exhaust
export const procar: EngineConfiguration = {
    label: 'BMW M1 Procar',
    subtitle: '3.5 inline-6 · race exhaust',
    engine: {
        limiter: 9000,
        soft_limiter: 9000,
        limiter_ms: 150,
    },
    drivetrain: {
        shiftTime: 100,
        damping: 12,
        /* ZF 5-speed dog-leg */
        gears: [2.42, 1.61, 1.14, 0.846, 0.704],
        final_drive: 4.22,
    },
    wheelRadius: 0.33, // 16" race slicks
    synth: {
        firing: evenFiring(6, [0, 0, 0, 1, 1, 1], [0, 0.06, 0.12, 0.03, 0.09, 0.15], [0.03, -0.02, 0.02, -0.03, 0.01, -0.01]),
        bankDelayMs: [0, 0.2],
        exhaustLength: 2.8,
        pulseWidth: 0.38,
        roughness: 0.4,
        resonances: [
            { freq: 160, q: 2.2, gain: 0.5 },
            { freq: 540, q: 3, gain: 0.35 },
            { freq: 1600, q: 4, gain: 0.15 },
        ],
        muffler: { closed: 1500, open: 6000 },
        exhaustMix: 1.0,
        blockMix: 0.4,
        intake: 0.18,
        mechanical: 0.07,
        crackle: 0.9,
        whineTeeth: 26,
        whine: 0.04,
        gain: 1.0,
    },
}

// Audi 2.5 TFSI inline five, 144° firing (1-2-4-5-3): odd count + unequal
// runners give the five-cylinder warble
export const audi_rs3: EngineConfiguration = {
    label: 'Audi RS 3',
    subtitle: '2.5 TFSI inline-5 · turbo',
    engine: {
        idle: 900,
        limiter: 7200,
        soft_limiter: 7100,
        limiter_ms: 60,
        torque: 480,
        inertia: 1.1,
    },
    drivetrain: {
        shiftTime: 40,
        damping: 10,
        /* 7-speed S tronic, the two output finals folded into one (approximate) */
        gears: [3.16, 2.1, 1.4, 1.05, 0.86, 0.73, 0.55],
        final_drive: 4.47,
    },
    wheelRadius: 0.321, // 265/30 R19
    synth: {
        firing: evenFiring(5, [], [0, 0.22, 0.08, 0.3, 0.14], [0.08, -0.06, 0.05, -0.08, 0.02]),
        bankDelayMs: [0],
        exhaustLength: 3.8,
        pulseWidth: 0.48,
        roughness: 0.3,
        resonances: [
            { freq: 110, q: 2.4, gain: 0.55 },
            { freq: 420, q: 3, gain: 0.3 },
            { freq: 1250, q: 4.5, gain: 0.1 },
        ],
        muffler: { closed: 700, open: 3600 },
        exhaustMix: 1.0,
        blockMix: 0.3,
        intake: 0.1,
        mechanical: 0.04,
        crackle: 0.8,
        whineTeeth: 20,
        whine: 0.02,
        turbo: { freq: 5200, whistle: 0.035, blowoff: 0.35 },
        gain: 1.2,
    },
}

// Mercedes-AMG 4.0 cross-plane V8 (1-5-4-8-6-3-7-2): each bank sees uneven
// intervals, which is the V8 burble
export const amg_v8: EngineConfiguration = {
    label: 'AMG V8',
    subtitle: '4.0 cross-plane V8 · biturbo',
    engine: {
        idle: 800,
        limiter: 7000,
        soft_limiter: 6900,
        limiter_ms: 80,
        torque: 700,
        inertia: 1.3,
    },
    drivetrain: {
        shiftTime: 60,
        damping: 10,
        /* AMG Speedshift MCT 9G */
        gears: [5.5, 3.33, 2.32, 1.66, 1.21, 1.0, 0.865, 0.717, 0.601],
        final_drive: 2.82,
    },
    wheelRadius: 0.34, // 285/30 R20
    synth: {
        firing: evenFiring(8, [0, 1, 0, 1, 1, 0, 1, 0], [0, 0.05, 0.1, 0.02, 0.07, 0.12, 0.04, 0.09], [0.05, -0.03, 0.02, -0.05, 0.04, -0.02, 0.03, -0.04]),
        bankDelayMs: [0, 0.9],
        exhaustLength: 4.2,
        pulseWidth: 0.5,
        roughness: 0.32,
        resonances: [
            { freq: 85, q: 2.2, gain: 0.6 },
            { freq: 330, q: 2.8, gain: 0.3 },
            { freq: 1050, q: 4, gain: 0.1 },
        ],
        muffler: { closed: 600, open: 3200 },
        exhaustMix: 1.0,
        blockMix: 0.25,
        intake: 0.1,
        mechanical: 0.03,
        crackle: 1.0,
        whineTeeth: 22,
        whine: 0.015,
        turbo: { freq: 4600, whistle: 0.02, blowoff: 0.25 },
        gain: 1.1,
    },
}

/* Hyundai Ioniq 5 N: N Active Sound+ voices over the virtual 8-speed N e-Shift */
const ioniq5n = {
    engine: {
        idle: 800,
        limiter: 7000,
        soft_limiter: 6900,
        limiter_ms: 60,
        torque: 600,
        inertia: 1.0,
    },
    drivetrain: {
        shiftTime: 60,
        damping: 10,
        /* Close-ratio virtual steps, ~260 km/h in 8th */
        gears: [5.0, 4.01, 3.22, 2.58, 2.07, 1.66, 1.33, 1.07],
        final_drive: 3.2,
    },
    wheelRadius: 0.363, // 275/35 R21
}

/* Placeholder combustion settings for voices that don't burn anything */
const noCombustion: EngineSynthSpec = {
    firing: [],
    bankDelayMs: [0],
    exhaustLength: 1,
    pulseWidth: 0.4,
    roughness: 0,
    resonances: [],
    muffler: { closed: 1000, open: 1000 },
    exhaustMix: 0,
    blockMix: 0,
    intake: 0,
    mechanical: 0,
    crackle: 0,
    whineTeeth: 0,
    whine: 0,
    gain: 1,
}

// "Ignition": a 2.0 turbo four in the spirit of the Elantra / i30 N, pops included
export const ioniq_5n_ignition: EngineConfiguration = {
    label: 'Ioniq 5 N · Ignition',
    subtitle: 'N Active Sound+ · 2.0 turbo four',
    ...ioniq5n,
    synth: {
        firing: evenFiring(4, [], [0, 0.1, 0.04, 0.14], [0.05, -0.04, 0.03, -0.05]),
        bankDelayMs: [0],
        exhaustLength: 3.2,
        pulseWidth: 0.45,
        roughness: 0.33,
        resonances: [
            { freq: 120, q: 2.4, gain: 0.55 },
            { freq: 480, q: 3, gain: 0.3 },
            { freq: 1500, q: 4.5, gain: 0.1 },
        ],
        muffler: { closed: 800, open: 3800 },
        exhaustMix: 1.0,
        blockMix: 0.3,
        intake: 0.12,
        mechanical: 0.04,
        crackle: 1.0,
        whineTeeth: 0,
        whine: 0,
        turbo: { freq: 5600, whistle: 0.03, blowoff: 0.3 },
        gain: 1.2,
    },
}

// "Evolution": futuristic synth tones that rise with speed
export const ioniq_5n_evolution: EngineConfiguration = {
    label: 'Ioniq 5 N · Evolution',
    subtitle: 'N Active Sound+ · futuristic EV',
    ...ioniq5n,
    synth: {
        ...noCombustion,
        voice: {
            kind: 'electric',
            baseHz: 45,
            hzPerRpm: 0.05,
            partials: [
                { ratio: 0.5, gain: 0.45 },
                { ratio: 1, gain: 1 },
                { ratio: 1.5, gain: 0.3 },
                { ratio: 2, gain: 0.45 },
                { ratio: 3.01, gain: 0.22 },
                { ratio: 4.02, gain: 0.1 },
                { ratio: 6.03, gain: 0.05 },
            ],
            motorWhine: 0.025,
        },
        gain: 0.6,
    },
}

// "Supersonic": fighter-jet turbine and roar
export const ioniq_5n_supersonic: EngineConfiguration = {
    label: 'Ioniq 5 N · Supersonic',
    subtitle: 'N Active Sound+ · fighter jet',
    ...ioniq5n,
    synth: {
        ...noCombustion,
        voice: {
            kind: 'jet',
            turbineBase: 700,
            turbineHzPerRpm: 0.75,
            whine: 0.2,
            roar: 1.6,
            rumble: 1.0,
        },
        gain: 1.35,
    },
}
