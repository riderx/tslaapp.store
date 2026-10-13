export type ShiftMode = 'chill' | 'average' | 'assertive'

export type ShiftModeConfig = {
    id: ShiftMode
    label: string
    /** Light-load upshift point, as a fraction of the limiter (full load always runs near the limiter) */
    upshift: number
    /** Downshift point, as a fraction of the limiter */
    downshift: number
    /** Min ms between automatic shifts */
    intervalMs: number
}

/** Tesla Autopilot / FSD-style assertiveness profiles */
export const SHIFT_MODES: Record<ShiftMode, ShiftModeConfig> = {
    chill: {
        id: 'chill',
        label: 'Chill',
        upshift: 0.32,
        downshift: 0.18,
        intervalMs: 380,
    },
    average: {
        id: 'average',
        label: 'Average',
        upshift: 0.45,
        downshift: 0.24,
        intervalMs: 300,
    },
    assertive: {
        id: 'assertive',
        label: 'Assertive',
        upshift: 0.82,
        downshift: 0.36,
        intervalMs: 240,
    },
}

export const SHIFT_MODE_LIST = Object.values(SHIFT_MODES)
