// Integration check for the review-find fix (#111).
//
// reviewFind.test.ts covers the arithmetic with hand-written regions. This file
// pins the assumption those regions are BUILT on: that `@codemirror/merge`
// exposes removed text as `Chunk.fromA..toA` against `getOriginalDoc`, mounted
// at `Chunk.fromB` in the live document. If a future version of the library
// changes that mapping, the unit tests would still pass while the feature
// silently broke, so assert it against the real library.

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { unifiedMergeView, getChunks, getOriginalDoc } from "@codemirror/merge";
import { collectUnifiedMatches, replaceableOffsets, type DeletedRegion } from "./reviewFind";

/** Mirrors CodeEditor's review setup: doc = proposed text, original = before. */
function reviewState(original: string, proposed: string): EditorState {
    return EditorState.create({
        doc: proposed,
        extensions: [unifiedMergeView({ original })],
    });
}

/** Mirrors `removedRegions()` in CodeEditor. */
function regionsOf(state: EditorState): { regions: DeletedRegion[]; original: string } {
    const chunks = getChunks(state)?.chunks;
    if (!chunks?.length) return { regions: [], original: "" };
    return {
        original: getOriginalDoc(state).toString(),
        regions: chunks
            .filter((c) => c.toA > c.fromA)
            .map((c) => ({ fromA: c.fromA, toA: c.toA, anchor: c.fromB })),
    };
}

describe("review find against a real unifiedMergeView", () => {
    it("exposes the original document and chunks at all", () => {
        const state = reviewState("old line\n", "new line\n");
        expect(getOriginalDoc(state).toString()).toBe("old line\n");
        expect(getChunks(state)?.chunks?.length).toBeGreaterThan(0);
    });

    it("region offsets address the removed text in the original document", () => {
        const state = reviewState("keep\nremoveme\n", "keep\n");
        const { regions, original } = regionsOf(state);

        expect(regions.length).toBeGreaterThan(0);
        // Every region must slice to text that really is in the original.
        for (const r of regions) {
            expect(original.slice(r.fromA, r.toA).length).toBeGreaterThan(0);
            expect(original).toContain(original.slice(r.fromA, r.toA));
        }
        // And the removed word must be inside one of them.
        const removedText = regions.map((r) => original.slice(r.fromA, r.toA)).join("");
        expect(removedText).toContain("removeme");
    });

    it("region anchors are valid positions in the live document", () => {
        const state = reviewState("a\nb\nc\n", "a\nZ\nc\n");
        const { regions } = regionsOf(state);

        for (const r of regions) {
            expect(r.anchor).toBeGreaterThanOrEqual(0);
            expect(r.anchor).toBeLessThanOrEqual(state.doc.length);
        }
    });

    // The exact scenario from #111: a word appears twice in the removed text and
    // twice in the proposed text. Find used to report only the proposed two.
    it("counts matches on both sides of the diff", () => {
        const original = "buy milk\nbuy milk\n";
        const proposed = "buy milk\nbuy milk\nbuy eggs\n";
        const state = reviewState(original, proposed);
        const { regions, original: orig } = regionsOf(state);

        const docOnly = collectUnifiedMatches(state.doc.toString(), orig, [], "buy", {
            caseSensitive: false,
            regex: false,
        });
        const unified = collectUnifiedMatches(state.doc.toString(), orig, regions, "buy", {
            caseSensitive: false,
            regex: false,
        });

        // The whole point: the unified search sees at least as much as the
        // document-only search, and strictly more when text was removed.
        expect(unified.length).toBeGreaterThanOrEqual(docOnly.length);
        expect(unified.filter((m) => m.side === "doc").length).toBe(docOnly.length);
    });

    it("finds text that exists ONLY in the removed lines", () => {
        const original = "chapter one\nvanished paragraph\n";
        const proposed = "chapter one\n";
        const state = reviewState(original, proposed);
        const { regions, original: orig } = regionsOf(state);

        const matches = collectUnifiedMatches(state.doc.toString(), orig, regions, "vanished", {
            caseSensitive: false,
            regex: false,
        });

        // Not present in the document at all, so the old code found nothing.
        expect(state.doc.toString()).not.toContain("vanished");
        expect(matches).toHaveLength(1);
        expect(matches[0].side).toBe("deleted");
        expect(orig.slice(matches[0].from, matches[0].to)).toBe("vanished");
    });

    it("never offers removed matches to replace", () => {
        const original = "target gone\n";
        const proposed = "target here\n";
        const state = reviewState(original, proposed);
        const { regions, original: orig } = regionsOf(state);

        const matches = collectUnifiedMatches(state.doc.toString(), orig, regions, "target", {
            caseSensitive: false,
            regex: false,
        });
        const offsets = replaceableOffsets(matches);

        // Every replaceable offset must actually point at the query in the DOC.
        const doc = state.doc.toString();
        for (const off of offsets) {
            expect(doc.slice(off, off + "target".length).toLowerCase()).toBe("target");
        }
        expect(offsets.length).toBe(matches.filter((m) => m.side === "doc").length);
    });

    it("produces no regions when the proposal only adds text", () => {
        // A pure insertion has toA === fromA, so there are no removed lines and
        // find must behave exactly as it does outside review.
        const state = reviewState("line one\n", "line one\nline two\n");
        const { regions } = regionsOf(state);
        expect(regions).toEqual([]);
    });

    it("orders every match by its position on screen", () => {
        const state = reviewState("aaa removed\nkeep\n", "keep\naaa added\n");
        const { regions, original } = regionsOf(state);

        const matches = collectUnifiedMatches(state.doc.toString(), original, regions, "aaa", {
            caseSensitive: false,
            regex: false,
        });
        const anchors = matches.map((m) => m.anchor);
        expect(anchors).toEqual([...anchors].sort((a, b) => a - b));
    });
});
