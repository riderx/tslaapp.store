export type ShiftMode = 'chill' | 'average' | 'assertive'

export type ShiftModeConfig = {
    id: ShiftMode
    label: string
    /** Upshift at this fraction of engine limiter */
    upshift: number
    /** Downshift below this fraction of engine limiter */
    downshift: number
    /** Min ms between automatic shifts */
    intervalMs: number
    /** Force upshift after this long at throttle if still in gear (sound-sim load can cap RPM) */
    maxHoldMs: number
}

/** Tesla Autopilot / FSD-style assertiveness profiles */
export const SHIFT_MODES: Record<ShiftMode, ShiftModeConfig> = {
    chill: {
        id: 'chill',
        label: 'Chill',
        upshift: 0.32,
        downshift: 0.18,
        intervalMs: 380,
        maxHoldMs: 1100,
    },
    average: {
        id: 'average',
        label: 'Average',
        upshift: 0.45,
        downshift: 0.24,
        intervalMs: 300,
        maxHoldMs: 2000,
    },
    assertive: {
        id: 'assertive',
        label: 'Assertive',
        upshift: 0.82,
        downshift: 0.36,
        intervalMs: 240,
        maxHoldMs: 3800,
    },
}

export const SHIFT_MODE_LIST = Object.values(SHIFT_MODES)
