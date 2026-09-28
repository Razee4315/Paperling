// Find across an AI review (unified merge) view. Issue #111.
//
// During review the editor runs `unifiedMergeView`, where the DOCUMENT holds
// only the proposed (new) text and the removed original lines are rendered as
// block widgets that are not part of the document at all. The find controller
// searched `state.doc`, so any match living in a removed line was invisible to
// it: you could see four hits on screen and the bar would say two, with
// navigation skipping the ones you were looking at.
//
// This module rebuilds the searchable surface the way the user actually sees
// it: the document text plus, for every chunk, the slice of the ORIGINAL
// document that chunk renders as removed lines. The result is one list ordered
// the way the eye travels down the screen.
//
// It is deliberately pure (no CodeMirror, no DOM) so the ordering and offset
// arithmetic — the part that is easy to get subtly wrong — is unit-testable.

import { findAll, matchLength } from "./findReplace";

/** A run of original-document text rendered as removed lines by one chunk. */
export interface DeletedRegion {
    /** Start offset in the ORIGINAL document. `Chunk.fromA`. */
    fromA: number;
    /** End offset in the ORIGINAL document. `Chunk.toA`. */
    toA: number;
    /**
     * Position in the LIVE document where this chunk's widget is mounted.
     * `@codemirror/merge` adds it at `Chunk.fromB`, as a block widget, so the
     * removed lines paint directly above that chunk's new text.
     */
    anchor: number;
}

/** Which surface a match was found on. Only `doc` matches are replaceable. */
export type MatchSide = "doc" | "deleted";

export interface UnifiedMatch {
    side: MatchSide;
    /**
     * For `doc`, offsets into the live document (usable directly as CodeMirror
     * positions). For `deleted`, offsets into the ORIGINAL document — NOT valid
     * document positions, which is exactly why they must never reach replace.
     */
    from: number;
    to: number;
    /**
     * Live-document position this match sits at or under, used for ordering and
     * for scrolling. Equal to `from` for `doc` matches; the owning chunk's
     * `anchor` for `deleted` ones.
     */
    anchor: number;
    /**
     * 0-based index of this match among the matches of its own region, so the
     * highlighter can pick the right occurrence inside the widget's DOM without
     * needing to map model offsets onto rendered lines.
     */
    ordinalInRegion: number;
}

export interface FindOpts {
    caseSensitive: boolean;
    regex: boolean;
}

/** Matches inside one string, as offsets shifted by `base`. */
function matchesIn(text: string, base: number, query: string, opts: FindOpts): Array<{ from: number; to: number }> {
    return findAll(text, query, opts.caseSensitive, opts.regex)
        .map((at) => ({
            from: base + at,
            to: base + at + matchLength(text, at, query, opts.caseSensitive, opts.regex),
        }))
        .filter((r) => r.to > r.from);
}

/**
 * Every match visible in the review view, in top-to-bottom screen order.
 *
 * Pass `regions: []` outside review and this reduces to a plain document
 * search, which keeps the non-review path byte-for-byte identical.
 *
 * Each region is searched on its own rather than as part of one concatenated
 * string, so a regex can never match across the seam between removed text and
 * the document — those are separate blocks on screen, and a match spanning them
 * could not be highlighted or navigated to coherently.
 */
export function collectUnifiedMatches(
    docText: string,
    originalText: string,
    regions: readonly DeletedRegion[],
    query: string,
    opts: FindOpts
): UnifiedMatch[] {
    if (!query) return [];

    const out: UnifiedMatch[] = matchesIn(docText, 0, query, opts).map((r, i) => ({
        side: "doc" as const,
        from: r.from,
        to: r.to,
        anchor: r.from,
        ordinalInRegion: i,
    }));

    for (const region of regions) {
        // Guard against a malformed range rather than handing slice() nonsense.
        if (!(region.toA > region.fromA)) continue;
        const text = originalText.slice(region.fromA, region.toA);
        matchesIn(text, region.fromA, query, opts).forEach((r, i) => {
            out.push({
                side: "deleted",
                from: r.from,
                to: r.to,
                anchor: region.anchor,
                ordinalInRegion: i,
            });
        });
    }

    // Screen order: by anchor, and at the same anchor the removed lines come
    // first because the widget is a block widget mounted at `fromB`, i.e. it
    // paints above the new text that starts there.
    return out.sort((a, b) => {
        if (a.anchor !== b.anchor) return a.anchor - b.anchor;
        if (a.side !== b.side) return a.side === "deleted" ? -1 : 1;
        return a.from - b.from;
    });
}

/**
 * The document-side matches as plain ranges, for the decoration field.
 *
 * The find bar counts every match, removed ones included, but decorations can
 * only mark document text — so the bar's indices and the decoration array's
 * indices are different numbering systems. Use `activeDocIndex` to cross over.
 */
export function docRanges(matches: readonly UnifiedMatch[]): Array<{ from: number; to: number }> {
    return matches.filter((m) => m.side === "doc").map((m) => ({ from: m.from, to: m.to }));
}

/**
 * Translate a find-bar index into an index into `docRanges(matches)`, or -1 when
 * the active match is on the removed side and therefore has no decoration to
 * emphasise. Passing the bar's index straight through would emphasise an
 * unrelated match whenever a removed one appeared earlier in the list.
 */
export function activeDocIndex(matches: readonly UnifiedMatch[], barIndex: number): number {
    if (matches[barIndex]?.side !== "doc") return -1;
    let n = 0;
    for (let i = 0; i < barIndex; i++) {
        if (matches[i].side === "doc") n++;
    }
    return n;
}

/**
 * Document offsets of the replaceable matches, in document order.
 *
 * Replace must never touch the removed side: that text is the version being
 * replaced, it is not in the document, and its offsets index a different
 * string. Feeding them to a splice would corrupt the file at unrelated
 * positions. Callers use this instead of mapping the match list directly.
 */
export function replaceableOffsets(matches: readonly UnifiedMatch[]): number[] {
    return matches
        .filter((m) => m.side === "doc")
        .map((m) => m.from)
        .sort((a, b) => a - b);
}
