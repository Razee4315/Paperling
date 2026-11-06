import { describe, expect, it } from "vitest";
import { scoreItem } from "./CommandPalette";

const rank = (query: string, labels: string[]) =>
    labels
        .map((label) => ({ label, score: scoreItem(query, [label]) }))
        .filter((item) => item.score !== -1)
        .sort((a, b) => a.score - b.score)
        .map((item) => item.label);

describe("scoreItem", () => {
    const sorts = ["Sort lines A to Z", "Sort lines Z to A"];

    it("ranks the label typed word for word first. EDIT-04", () => {
        expect(rank("Sort lines Z to A", sorts)[0]).toBe("Sort lines Z to A");
        expect(rank("sort lines z to a", sorts)[0]).toBe("Sort lines Z to A");
        expect(rank("Z to A", sorts)[0]).toBe("Sort lines Z to A");
    });

    it("keeps matching multi-word queries in any order", () => {
        expect(scoreItem("fil new", ["New file"])).not.toBe(-1);
    });

    it("does not treat a single word as a phrase, so better matches still win", () => {
        expect(rank("file", ["Profile picture", "File history"])[0]).toBe("File history");
    });

    it("returns -1 when a term matches nothing", () => {
        expect(scoreItem("zzz", ["New file"])).toBe(-1);
    });
});
