// Paints the active find match when it lands inside an AI review's removed
// lines. Issue #111.
//
// Removed lines are a block widget, not document text, so CodeMirror
// decorations cannot reach them. They ARE real DOM, so the CSS Custom Highlight
// API works — the same mechanism reader-mode find already uses, and it needs no
// DOM mutation, so @codemirror/merge's widget is left untouched.
//
// Everything here is best-effort by design. Match counting, ordering,
// navigation and replace safety live in reviewFind.ts and never call into this
// module, so if the highlight is skipped the user still gets the right count
// and still gets scrolled to the right chunk.

import type { EditorView } from "@codemirror/view";
import { collectDomMatches } from "./domTextMatches";

const HIGHLIGHT_REMOVED = "paperling-find-removed";

/** The chunk's Accept/Reject buttons are chrome, not content. */
const SKIP_INSIDE = [".cm-chunkButtons"];

type HighlightsRegistry = {
    set(name: string, highlight: unknown): void;
    delete(name: string): void;
};

const cssHighlights = (): HighlightsRegistry | null => {
    const css = (globalThis as { CSS?: { highlights?: HighlightsRegistry } }).CSS;
    return css?.highlights ?? null;
};

const HighlightCtor = (): (new (...r: Range[]) => unknown) | undefined =>
    (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

export function clearRemovedHighlight(): void {
    cssHighlights()?.delete(HIGHLIGHT_REMOVED);
}

/**
 * The rendered removed-lines element for the chunk mounted at `anchor`, or null.
 *
 * `@codemirror/merge` adds the deletion as a block widget at `Chunk.fromB`, so
 * it renders as the previous sibling of the block holding that position. Returns
 * null when the chunk is scrolled out of the viewport (CodeMirror only renders
 * what is near the visible range), so callers must scroll first.
 *
 * Deliberately narrow: it checks only the immediate previous sibling rather than
 * scanning backwards, so an unexpected DOM shape yields null instead of
 * emphasising some unrelated chunk.
 */
export function deletedChunkElementAt(view: EditorView, anchor: number): HTMLElement | null {
    try {
        const { node } = view.domAtPos(anchor);
        let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
        // Climb to the block that is a direct child of .cm-content.
        while (el?.parentElement && !el.parentElement.classList.contains("cm-content")) {
            el = el.parentElement;
        }
        const prev = el?.previousElementSibling;
        return prev instanceof HTMLElement && prev.classList.contains("cm-deletedChunk") ? prev : null;
    } catch {
        // domAtPos throws for a position outside the rendered range.
        return null;
    }
}

/**
 * Highlight occurrence `ordinal` of `query` inside one removed chunk.
 *
 * Returns whether a highlight was actually painted, so callers can tell "shown"
 * from "scrolled but not painted" rather than guessing.
 *
 * Bails out, leaving nothing painted, when:
 *  - the query spans lines: the model counts such a match but the rendered
 *    lines are separate elements with no newline between them, so the ordinals
 *    would not line up;
 *  - the DOM yields fewer occurrences than the model did, which happens when a
 *    line is split at a change boundary mid-match (see domTextMatches'
 *    documented element-boundary limit). Painting `ranges[ordinal]` blindly
 *    there would emphasise the wrong hit;
 *  - the platform has no Custom Highlight API.
 */
export function highlightRemovedMatch(
    chunkEl: HTMLElement | null,
    query: string,
    caseSensitive: boolean,
    ordinal: number
): boolean {
    clearRemovedHighlight();
    if (!chunkEl || !query || query.includes("\n")) return false;

    const reg = cssHighlights();
    const H = HighlightCtor();
    if (!reg || !H) return false;

    const ranges = collectDomMatches(chunkEl, query, caseSensitive, SKIP_INSIDE);
    const range = ranges[ordinal];
    if (!range) return false;

    reg.set(HIGHLIGHT_REMOVED, new H(range));
    return true;
}
