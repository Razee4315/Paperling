import { describe, it, expect } from "vitest";
import { keyboardInset } from "./keyboardInset";

describe("keyboardInset", () => {
    it("returns 0 when both viewports agree (keyboard closed, or device resized for us)", () => {
        // The regression that bit before: a device that DOES shrink the layout
        // viewport must yield 0, or the shell gets a second keyboard's padding.
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 915, offsetTop: 0 })).toBe(0);
        expect(keyboardInset({ layoutHeight: 560, visualHeight: 560, offsetTop: 0 })).toBe(0);
    });

    it("measures an overlay keyboard exactly (layout viewport unchanged)", () => {
        // 915px shell with a 391px keyboard covering the bottom.
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 524, offsetTop: 0 })).toBe(391);
    });

    it("subtracts iOS's pan offset so a panned viewport isn't read as covered", () => {
        // iOS pans the visual viewport down by 100 instead of resizing.
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 815, offsetTop: 100 })).toBe(0);
        // Partially covered + panned.
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 524, offsetTop: 50 })).toBe(341);
    });

    it("ignores pinch-zoom (visual viewport shrink is not a keyboard)", () => {
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 457, offsetTop: 0, scale: 2 })).toBe(0);
        // A hair above 1 (rounding) is still treated as zoomed.
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 910, offsetTop: 0, scale: 1.02 })).toBe(0);
    });

    it("returns 0 without the visualViewport API", () => {
        expect(keyboardInset({ layoutHeight: 915, visualHeight: undefined, offsetTop: 0 })).toBe(0);
    });

    it("clamps mid-rotation negative frames to 0", () => {
        // visual viewport momentarily larger than the layout viewport.
        expect(keyboardInset({ layoutHeight: 400, visualHeight: 415, offsetTop: 0 })).toBe(0);
        expect(keyboardInset({ layoutHeight: 400, visualHeight: 401, offsetTop: 5 })).toBe(0);
    });

    it("treats sub-pixel noise as closed", () => {
        expect(keyboardInset({ layoutHeight: 915, visualHeight: 914.5, offsetTop: 0 })).toBe(0);
    });
});
