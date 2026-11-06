import { describe, expect, it } from "vitest";
import { orderedListMarkerCharacters } from "./orderedListMarkers";

describe("ordered-list marker space (PREVIEW-08, #270)", () => {
    it("grows at digit boundaries, including non-default starts", () => {
        expect(orderedListMarkerCharacters(undefined, Array(9))).toBe(1);
        expect(orderedListMarkerCharacters(undefined, Array(13))).toBe(2);
        expect(orderedListMarkerCharacters(98, Array(3))).toBe(3);
        expect(orderedListMarkerCharacters(999999999, Array(2))).toBe(10);
    });

    it("reserves room for zero and negative counters, including the sign", () => {
        expect(orderedListMarkerCharacters(0, Array(1))).toBe(1);
        expect(orderedListMarkerCharacters(-100, Array(102))).toBe(4);
    });

    it("includes explicit item values and the sequence after each reset", () => {
        expect(orderedListMarkerCharacters(1, [undefined, 999, undefined, 1])).toBe(4);
        expect(orderedListMarkerCharacters(1000, [1, undefined])).toBe(1);
    });

    it("handles descending counters without assuming the final item is widest", () => {
        expect(orderedListMarkerCharacters(undefined, Array(12), true)).toBe(2);
        expect(orderedListMarkerCharacters(100, Array(3), true)).toBe(3);
        expect(orderedListMarkerCharacters(0, [undefined, -99, undefined], true)).toBe(4);
    });

    it("keeps empty lists valid", () => {
        expect(orderedListMarkerCharacters(undefined, [])).toBe(1);
    });

    it("parses raw HTML integer attributes before advancing counters", () => {
        expect(orderedListMarkerCharacters("98", [undefined, "99", undefined])).toBe(3);
        expect(orderedListMarkerCharacters("invalid", ["invalid", undefined])).toBe(1);
        expect(orderedListMarkerCharacters(" -99", [undefined, undefined])).toBe(3);
    });
});
