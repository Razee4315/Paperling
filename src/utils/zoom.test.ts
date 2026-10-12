import { describe, expect, it } from "vitest";
import { formatZoom, parseZoom, stepZoom, ZOOM_LEVELS } from "./zoom";

describe("text zoom (ZOOM-01)", () => {
    it("steps to the neighbouring level and stops at the ends", () => {
        expect(stepZoom(1, 1)).toBe(1.1);
        expect(stepZoom(1, -1)).toBe(0.9);
        expect(stepZoom(0.67, -1)).toBe(0.5);
        expect(stepZoom(0.67, 1)).toBe(0.75);
        expect(stepZoom(3, 1)).toBe(3);
        expect(stepZoom(0.5, -1)).toBe(0.5);
    });
    it("snaps an off-grid value to the next real level in the direction asked", () => {
        expect(stepZoom(1.2, 1)).toBe(1.25);
        expect(stepZoom(1.2, -1)).toBe(1.1);
    });
    it("walks the whole range in both directions", () => {
        let zoom = ZOOM_LEVELS[0];
        const up: number[] = [zoom];
        while (stepZoom(zoom, 1) !== zoom) up.push((zoom = stepZoom(zoom, 1)));
        expect(up).toEqual([...ZOOM_LEVELS]);
        const down: number[] = [zoom];
        while (stepZoom(zoom, -1) !== zoom) down.push((zoom = stepZoom(zoom, -1)));
        expect(down).toEqual([...ZOOM_LEVELS].reverse());
    });
    it("falls back to 100% for missing, malformed or out-of-range stored values", () => {
        expect(parseZoom(null)).toBe(1);
        expect(parseZoom("abc")).toBe(1);
        expect(parseZoom("40")).toBe(1);
        expect(parseZoom("0.1")).toBe(1);
        expect(parseZoom("1.5")).toBe(1.5);
        expect(formatZoom(0.67)).toBe("67%");
    });
});
