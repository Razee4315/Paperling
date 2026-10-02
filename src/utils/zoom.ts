// Text zoom (ZOOM-01). Ctrl +/- and Ctrl+wheel are reflexes in every reader and
// browser; here they did nothing, and text size was four presets inside a menu.
// Zoom is a multiplier on top of the chosen font size (it scales the reading
// and editing text, not the window chrome), stepped through the same levels
// browsers use so one press is always a visible change.

export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const ZOOM_DEFAULT = 1;

const MIN = ZOOM_LEVELS[0];
const MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

/** The next level above (`1`) or below (`-1`) `current`; stays put at the ends. */
export function stepZoom(current: number, direction: 1 | -1): number {
    // A small tolerance so a stored 0.67 doesn't count as "below 0.67".
    const eps = 0.001;
    if (direction > 0) return ZOOM_LEVELS.find((level) => level > current + eps) ?? MAX;
    return [...ZOOM_LEVELS].reverse().find((level) => level < current - eps) ?? MIN;
}

/** A stored zoom, or the default for anything missing, malformed or out of range. */
export function parseZoom(raw: string | null): number {
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value >= MIN && value <= MAX ? value : ZOOM_DEFAULT;
}

export const formatZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`;
