/**
 * Procedural engine voice, synthesized combustion by combustion in an
 * AudioWorklet. No sample loops: every firing event is placed on the crank
 * angle given by the firing order, travels down its runner, joins its bank
 * collector and leaves through the exhaust line, while a second source
 * (block / intake / valvetrain) plays in phase from under the hood.
 */
export type FiringEvent = {
    /* Crank angle of the combustion in the 720° four-stroke cycle */
    angle: number;
    /* Exhaust bank the cylinder belongs to */
    bank: number;
    /* Extra runner length for this cylinder, in ms (unequal headers) */
    runnerMs?: number;
    /* Fixed strength offset for this cylinder (-0.3..0.3), the source of the warble */
    bias?: number;
};

export type Resonance = {
    freq: number;
    q: number;
    gain: number;
};

/* Synthetic EV voice (Hyundai N Active Sound+ "Evolution" style): tuned partials following RPM */
export type ElectricVoice = {
    kind: 'electric';
    /* Fundamental = baseHz + rpm * hzPerRpm */
    baseHz: number;
    hzPerRpm: number;
    /* Partials as ratios of the fundamental; upper ones open up with load */
    partials: { ratio: number; gain: number }[];
    /* Inverter / e-motor whine level */
    motorWhine: number;
};

/* Jet voice ("Supersonic" style): spooling turbine tones over exhaust roar */
export type JetVoice = {
    kind: 'jet';
    /* Turbine tone = turbineBase + rpm * turbineHzPerRpm, lagging like a spool */
    turbineBase: number;
    turbineHzPerRpm: number;
    whine: number;
    roar: number;
    rumble: number;
};

export type EngineSynthSpec = {
    /* Non-combustion voice; absent means the combustion model below */
    voice?: ElectricVoice | JetVoice;
    firing: FiringEvent[];
    /* Delay of each bank collector before the merge, in ms */
    bankDelayMs: number[];
    /* Exhaust line length in meters, sets the block -> tailpipe delay */
    exhaustLength: number;
    /* Combustion pulse width, as a fraction of the firing interval */
    pulseWidth: number;
    /* Turbulent part of each combustion (0..1) */
    roughness: number;
    /* Fixed collector / muffler resonances */
    resonances: Resonance[];
    /* Muffler low-pass cutoff with valves closed / fully open (Hz) */
    muffler: { closed: number; open: number };
    exhaustMix: number;
    blockMix: number;
    intake: number;
    mechanical: number;
    /* Overrun pops and crackles (0..1) */
    crackle: number;
    /* Gearbox whine: gear mesh teeth per crank revolution and level */
    whineTeeth: number;
    whine: number;
    turbo?: { freq: number; whistle: number; blowoff: number };
    /* Overall output trim */
    gain: number;
};

export type EngineSynthOptions = {
    spec: EngineSynthSpec;
    idle: number;
    limiter: number;
};

export const ENGINE_SYNTH_PROCESSOR = 'engine-synth';
