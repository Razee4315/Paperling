/**
 * Editor ⇄ preview scroll sync, and "keep my place" across view-mode switches.
 *
 * Each side (the CodeMirror editor, the preview <main>) registers a Scroller.
 * The sync is LINE-anchored: the side that scrolled reports which source line
 * sits at its top edge, and the other side scrolls that same line to its top.
 * The old version mirrored the scroll FRACTION, which drifts badly whenever
 * the two sides have different shapes — an image, a table or a long code
 * block is a few source lines but a tall rendered block, so halfway down the
 * source was nowhere near halfway down the preview. SYNC-01.
 *
 * The fraction path is kept for the ends (top/bottom must line up exactly
 * even when the last lines render taller or shorter) and as a fallback for a
 * side that can't map lines yet.
 *
 * To avoid feedback loops, when we set the position programmatically on side
 * X we mark X as "ignoring" for a short window — its native scroll handler
 * fires from the imperative scrollTop change, and we drop that echo.
 */

export interface Scroller {
    setFraction: (fraction: number) => void;
    /** Content-relative source line (1-based, fractional) at the top edge, or
     *  null when unknown (hidden pane, nothing rendered yet). */
    getTopLine?: () => number | null;
    /** Scroll so this (fractional) source line sits at the top edge. A
     *  `handoff` call (view-mode switch) may also bring the caret along. */
    scrollToLine?: (line: number, opts?: HandoffOptions) => void;
}

export type SyncSide = "code" | "preview";

export interface HandoffOptions {
    /** A view-mode switch, not a continuous sync: the pane was just shown. */
    handoff?: boolean;
    /** Also focus the pane (entering the editor from the reader). */
    focus?: boolean;
}

export interface ScrollSync {
    /** Side X registers its imperative scroller. */
    register: (side: SyncSide, scroller: Scroller | null) => void;
    /** Side X reports a scroll (user-driven or not); fraction is 0..1. */
    notify: (side: SyncSide, fraction: number) => void;
    /** Disable / enable syncing (used to turn off in non-split modes). */
    setEnabled: (enabled: boolean) => void;
    /** Top line side X last reported while it was visible (null = never). */
    lastTopLine: (side: SyncSide) => number | null;
    /**
     * Put `to` where `from` was: used when the view mode switches, so the
     * editor opens at the paragraph you were reading (and vice versa) instead
     * of wherever it was left. MODE-01.
     */
    handoff: (from: SyncSide, to: SyncSide, opts?: HandoffOptions) => void;
    /** Record side X's current top line now, if it can be measured (a
     *  visible pane). Called right before a layout change. MODE-02. */
    capture: (side: SyncSide) => void;
}

/** Top/bottom snap zone for the fraction ends. */
const END_EPSILON = 0.002;

export function createScrollSync(): ScrollSync {
    const scrollers: Record<SyncSide, Scroller | null> = { code: null, preview: null };
    const ignore: Record<SyncSide, boolean> = { code: false, preview: false };
    const lastTop: Record<SyncSide, number | null> = { code: null, preview: null };
    const lastFraction: Record<SyncSide, number> = { code: 0, preview: 0 };
    let enabled = false;
    const ignoreTimers: Record<SyncSide, number | null> = { code: null, preview: null };

    const setIgnore = (side: SyncSide) => {
        ignore[side] = true;
        if (ignoreTimers[side] !== null) {
            window.clearTimeout(ignoreTimers[side] as number);
        }
        ignoreTimers[side] = window.setTimeout(() => {
            ignore[side] = false;
            ignoreTimers[side] = null;
        }, 80);
    };

    /** Move `target` to match `fraction` / `line` of the other side. */
    const apply = (target: Scroller, fraction: number, line: number | null, opts?: HandoffOptions) => {
        const f = Math.max(0, Math.min(1, fraction));
        if (line == null || !target.scrollToLine || (!opts?.handoff && (f <= END_EPSILON || f >= 1 - END_EPSILON))) {
            target.setFraction(f);
            return;
        }
        target.scrollToLine(line, opts);
    };

    return {
        register: (side, scroller) => {
            scrollers[side] = scroller;
        },
        notify: (side, fraction) => {
            const source = scrollers[side];
            const line = source?.getTopLine?.() ?? null;
            if (line != null) lastTop[side] = line;
            lastFraction[side] = fraction;
            if (!enabled) return;
            if (ignore[side]) return; // this scroll was triggered by our own programmatic sync
            const otherSide: SyncSide = side === "code" ? "preview" : "code";
            const other = scrollers[otherSide];
            if (!other) return;
            setIgnore(otherSide); // we're about to scroll the other side; suppress its echo
            apply(other, fraction, line);
        },
        setEnabled: (e) => {
            enabled = e;
        },
        lastTopLine: (side) => lastTop[side],
        handoff: (from, to, opts) => {
            const target = scrollers[to];
            if (!target) return;
            const line = lastTop[from];
            // Nothing recorded yet (the source pane was never scrolled or
            // shown): leave the target where it is.
            if (line == null) return;
            setIgnore(to);
            apply(target, lastFraction[from], line, { handoff: true, ...opts });
            // The target now shows this line; don't wait for its scroll
            // event (a programmatic scroll may never produce one before the
            // next switch). MODE-02.
            lastTop[to] = line;
            lastFraction[to] = lastFraction[from];
        },
        capture: (side) => {
            const line = scrollers[side]?.getTopLine?.() ?? null;
            if (line != null) lastTop[side] = line;
        },
    };
}

/**
 * Source-line ⇄ pixel mapping over a list of block anchors (the preview's
 * `data-source-line` blocks), interpolating linearly INSIDE a block so a long
 * code block or table scrolls smoothly instead of jumping block to block.
 * Accessors (not arrays) so callers can binary-search live DOM rects without
 * measuring every block on every scroll frame.
 */
export interface AnchorList {
    count: number;
    /** Source line of anchor i (ascending). */
    lineAt: (i: number) => number;
    /** Top offset (px, scroll-content coordinates) of anchor i (ascending). */
    topAt: (i: number) => number;
    /** Line just past the last anchor's block, and the content bottom (px). */
    endLine: number;
    endTop: number;
}

function lastIndexWhere(count: number, pred: (i: number) => boolean): number {
    let lo = 0, hi = count - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pred(mid)) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return ans;
}

/** Fractional source line shown at scroll offset `y`. */
export function offsetToLine(a: AnchorList, y: number): number {
    if (a.count === 0) return 1;
    const i = lastIndexWhere(a.count, (k) => a.topAt(k) <= y);
    if (i < 0) {
        // Above the first block (frontmatter card, top padding).
        const top0 = a.topAt(0);
        const line0 = a.lineAt(0);
        return top0 > 0 ? 1 + (Math.max(0, y) / top0) * (line0 - 1) : line0;
    }
    const line = a.lineAt(i);
    const top = a.topAt(i);
    const nextLine = i + 1 < a.count ? a.lineAt(i + 1) : a.endLine;
    const nextTop = i + 1 < a.count ? a.topAt(i + 1) : a.endTop;
    const span = nextTop - top;
    if (span <= 0) return line;
    return line + Math.min(1, (y - top) / span) * (nextLine - line);
}

/** Scroll offset at which (fractional) source line `line` reaches the top. */
export function lineToOffset(a: AnchorList, line: number): number {
    if (a.count === 0) return 0;
    const i = lastIndexWhere(a.count, (k) => a.lineAt(k) <= line);
    if (i < 0) {
        const line0 = a.lineAt(0);
        return line0 > 1 ? ((line - 1) / (line0 - 1)) * a.topAt(0) : 0;
    }
    const l = a.lineAt(i);
    const top = a.topAt(i);
    const nextLine = i + 1 < a.count ? a.lineAt(i + 1) : a.endLine;
    const nextTop = i + 1 < a.count ? a.topAt(i + 1) : a.endTop;
    const lines = nextLine - l;
    if (lines <= 0) return top;
    return top + Math.min(1, (line - l) / lines) * (nextTop - top);
}
