import { describe, it, expect } from "vitest";
import { locateText } from "./revealText";

describe("locateText (MODE-03)", () => {
    const doc = ["# Title", "", "The word here.", "", "## Later", "", "Some **bold** word and the word again."].join("\n");
    const at = (r: { from: number; to: number } | null) => (r ? doc.slice(r.from, r.to) : null);

    it("finds an exact selection starting at the block's source line", () => {
        const r = locateText(doc, 7, "word");
        // The occurrence in the paragraph at line 7, not the one on line 3.
        expect(r!.from).toBe(doc.indexOf("word and"));
        expect(at(r)).toBe("word");
    });

    it("matches across markdown syntax the reader doesn't show", () => {
        expect(at(locateText(doc, 7, "bold word"))).toBe("bold** word");
        expect(at(locateText(doc, 7, "Some bold"))).toBe("Some **bold");
    });

    it("uses only the first line of a multi-line selection and falls back to the longest word", () => {
        expect(at(locateText(doc, 7, "Some bold\nsecond paragraph"))).toBe("Some **bold");
        expect(at(locateText(doc, 5, "Later heading missing"))).toBe("Later");
    });

    it("returns null when nothing matches or the selection is blank", () => {
        expect(locateText(doc, 1, "absent text")).toBeNull();
        expect(locateText(doc, 1, "   ")).toBeNull();
    });
});
