import { describe, it, expect } from "vitest";
import {
    collectUnifiedMatches,
    replaceableOffsets,
    docRanges,
    activeDocIndex,
    type DeletedRegion,
    type UnifiedMatch,
} from "./reviewFind";

const plain = { caseSensitive: false, regex: false };

describe("collectUnifiedMatches", () => {
    it("reduces to a plain document search when there are no removed regions", () => {
        const matches = collectUnifiedMatches("alpha beta alpha", "", [], "alpha", plain);
        expect(matches.map((m) => [m.side, m.from, m.to])).toEqual([
            ["doc", 0, 5],
            ["doc", 11, 16],
        ]);
    });

    it("returns nothing for an empty query", () => {
        expect(collectUnifiedMatches("alpha", "alpha", [{ fromA: 0, toA: 5, anchor: 0 }], "", plain)).toEqual([]);
    });

    // The reported case: two hits in the new text, two more in the removed
    // lines, and the bar used to say 2. #111.
    it("finds matches in removed lines that are not in the document", () => {
        const original = "milk\neggs\nmilk\n";
        const doc = "milk\nbread\n";
        const regions: DeletedRegion[] = [{ fromA: 0, toA: original.length, anchor: 0 }];

        const matches = collectUnifiedMatches(doc, original, regions, "milk", plain);

        expect(matches).toHaveLength(3);
        expect(matches.filter((m) => m.side === "deleted")).toHaveLength(2);
        expect(matches.filter((m) => m.side === "doc")).toHaveLength(1);
    });

    it("reports removed-side offsets against the original document, not the live one", () => {
        // "gamma" sits at 12 in the original and nowhere in the doc, so a naive
        // implementation reusing document offsets would point at the wrong text.
        const original = "alpha\nbeta\ngamma\n";
        const doc = "alpha\n";
        const regions: DeletedRegion[] = [{ fromA: 6, toA: 17, anchor: 6 }];

        const [m] = collectUnifiedMatches(doc, original, regions, "gamma", plain);

        expect(m.side).toBe("deleted");
        expect(original.slice(m.from, m.to)).toBe("gamma");
        expect(m.from).toBe(11);
    });

    it("orders removed lines before the new text of the same chunk", () => {
        // One chunk at anchor 10: its removed lines paint above its new text,
        // because @codemirror/merge mounts a block widget at fromB.
        const original = "hit-old";
        const doc = "aaaaaaaaaahit-new";
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 7, anchor: 10 }];

        const sides = collectUnifiedMatches(doc, original, regions, "hit", plain).map((m) => m.side);

        expect(sides).toEqual(["deleted", "doc"]);
    });

    it("interleaves multiple chunks in screen order", () => {
        //  doc:  "x .... x .... x"   with removed chunks anchored at 10 and 20
        const doc = "x" + " ".repeat(14) + "x" + " ".repeat(9) + "x";
        const original = "x-removed-early x-removed-late";
        const regions: DeletedRegion[] = [
            { fromA: 16, toA: 30, anchor: 20 }, // deliberately out of order on input
            { fromA: 0, toA: 15, anchor: 10 },
        ];

        const matches = collectUnifiedMatches(doc, original, regions, "x", plain);
        const anchors = matches.map((m) => m.anchor);

        // Sorted ascending regardless of the order regions were supplied in.
        expect(anchors).toEqual([...anchors].sort((a, b) => a - b));
        expect(matches.map((m) => `${m.side}@${m.anchor}`)).toEqual([
            "doc@0",
            "deleted@10",
            "doc@15",
            "deleted@20",
            "doc@25",
        ]);
    });

    it("numbers matches within each region so the highlighter can pick one", () => {
        const original = "dup dup dup";
        const doc = "";
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 11, anchor: 0 }];

        const ordinals = collectUnifiedMatches(doc, original, regions, "dup", plain).map((m) => m.ordinalInRegion);

        expect(ordinals).toEqual([0, 1, 2]);
    });

    it("honours case sensitivity on both sides", () => {
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 3, anchor: 0 }];
        const sensitive = { caseSensitive: true, regex: false };

        expect(collectUnifiedMatches("ABC", "abc", regions, "abc", sensitive)).toHaveLength(1);
        expect(collectUnifiedMatches("ABC", "abc", regions, "abc", plain)).toHaveLength(2);
    });

    it("supports regex on both sides", () => {
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 6, anchor: 0 }];
        const re = { caseSensitive: false, regex: true };

        const matches = collectUnifiedMatches("a1b2", "x9y8z7", regions, "\\d", re);

        expect(matches).toHaveLength(5);
        expect(matches.filter((m) => m.side === "deleted")).toHaveLength(3);
    });

    it("never lets a regex match span the seam between removed and new text", () => {
        // "olddnew" only exists if the two surfaces are concatenated. They are
        // separate blocks on screen, so a match across them is not a real hit.
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 4, anchor: 0 }];
        const matches = collectUnifiedMatches("new", "old", regions, "oldnew", { caseSensitive: false, regex: true });
        expect(matches).toEqual([]);
    });

    it("skips malformed regions instead of slicing nonsense", () => {
        const regions: DeletedRegion[] = [
            { fromA: 5, toA: 5, anchor: 0 }, // empty
            { fromA: 9, toA: 2, anchor: 0 }, // inverted
        ];
        expect(collectUnifiedMatches("", "abcabcabc", regions, "abc", plain)).toEqual([]);
    });
});

describe("docRanges / activeDocIndex", () => {
    // deleted, doc, deleted, doc  — the interleaving that breaks naive indexing.
    const mixed: UnifiedMatch[] = [
        { side: "deleted", from: 0, to: 3, anchor: 0, ordinalInRegion: 0 },
        { side: "doc", from: 5, to: 8, anchor: 5, ordinalInRegion: 0 },
        { side: "deleted", from: 9, to: 12, anchor: 10, ordinalInRegion: 1 },
        { side: "doc", from: 20, to: 23, anchor: 20, ordinalInRegion: 1 },
    ];

    it("keeps only document ranges", () => {
        expect(docRanges(mixed)).toEqual([
            { from: 5, to: 8 },
            { from: 20, to: 23 },
        ]);
    });

    it("maps bar indices onto decoration indices", () => {
        // Bar index 1 is the FIRST document match, so decoration index 0.
        expect(activeDocIndex(mixed, 1)).toBe(0);
        // Bar index 3 is the SECOND document match: decoration index 1, not 3.
        expect(activeDocIndex(mixed, 3)).toBe(1);
    });

    it("returns -1 for removed-side matches, which have no decoration", () => {
        expect(activeDocIndex(mixed, 0)).toBe(-1);
        expect(activeDocIndex(mixed, 2)).toBe(-1);
    });

    it("returns -1 for an out-of-range index", () => {
        expect(activeDocIndex(mixed, 99)).toBe(-1);
        expect(activeDocIndex(mixed, -1)).toBe(-1);
    });

    it("indexes identically to the bar when nothing was removed", () => {
        const docOnly = collectUnifiedMatches("a a a", "", [], "a", plain);
        expect(docRanges(docOnly)).toHaveLength(3);
        expect([0, 1, 2].map((i) => activeDocIndex(docOnly, i))).toEqual([0, 1, 2]);
    });

    it("agrees with the decoration array it describes", () => {
        // Property check: every doc match's mapped index must point back at itself.
        const ranges = docRanges(mixed);
        mixed.forEach((m, barIdx) => {
            if (m.side !== "doc") return;
            const decoIdx = activeDocIndex(mixed, barIdx);
            expect(ranges[decoIdx]).toEqual({ from: m.from, to: m.to });
        });
    });
});

describe("replaceableOffsets", () => {
    it("keeps only document matches, so replace can never rewrite removed text", () => {
        const original = "target gone";
        const doc = "target here";
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 11, anchor: 4 }];

        const matches = collectUnifiedMatches(doc, original, regions, "target", plain);
        expect(matches).toHaveLength(2);

        // The removed-side offset (0) must not appear: splicing the document at
        // an original-document offset would corrupt unrelated text.
        expect(replaceableOffsets(matches)).toEqual([0]);
        expect(matches.find((m) => m.side === "deleted")).toBeDefined();
    });

    it("returns document offsets in ascending order", () => {
        const doc = "z z z";
        const original = "z";
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 1, anchor: 3 }];

        expect(replaceableOffsets(collectUnifiedMatches(doc, original, regions, "z", plain))).toEqual([0, 2, 4]);
    });

    it("is empty when every match is on the removed side", () => {
        const regions: DeletedRegion[] = [{ fromA: 0, toA: 4, anchor: 0 }];
        const matches = collectUnifiedMatches("", "gone", regions, "gone", plain);
        expect(matches).toHaveLength(1);
        expect(replaceableOffsets(matches)).toEqual([]);
    });
});
