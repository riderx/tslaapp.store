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

export type EngineSynthSpec = {
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
