import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createScrollSync, lineToOffset, offsetToLine, type AnchorList, type Scroller } from "./scrollSync";

const mockScroller = () => {
    const calls: number[] = [];
    const s: Scroller = { setFraction: (f) => calls.push(f) };
    return { s, calls };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createScrollSync", () => {
    it("does nothing while disabled", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.notify("code", 0.5);
        expect(preview.calls).toEqual([]);
    });

    it("mirrors one side's fraction to the other when enabled", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);
        sync.notify("code", 0.5);
        expect(preview.calls).toEqual([0.5]);
    });

    it("clamps the fraction into [0,1]", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);
        sync.notify("code", 1.5);
        expect(preview.calls).toEqual([1]);
    });

    it("suppresses the echo from a programmatic scroll, then resumes after the window", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);

        sync.notify("code", 0.5); // drives preview; marks preview as ignoring
        expect(preview.calls).toEqual([0.5]);

        sync.notify("preview", 0.7); // echo from the programmatic scroll -> dropped
        expect(code.calls).toEqual([]);

        vi.advanceTimersByTime(100); // ignore window (80ms) elapses
        sync.notify("preview", 0.7); // genuine user scroll now propagates
        expect(code.calls).toEqual([0.7]);
    });
});

describe("line-anchored sync (SYNC-01) and mode handoff (MODE-01)", () => {
    const lineScroller = (top: number | null) => {
        const lines: number[] = [];
        const fractions: number[] = [];
        const handoffs: unknown[] = [];
        const s: Scroller = {
            setFraction: (f) => fractions.push(f),
            getTopLine: () => top,
            scrollToLine: (l, opts) => { lines.push(l); handoffs.push(opts); },
        };
        return { s, lines, fractions, handoffs };
    };

    it("syncs by source line, not by fraction, in the middle of the document", () => {
        const sync = createScrollSync();
        const code = lineScroller(120.5);
        const preview = lineScroller(null);
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);
        sync.notify("code", 0.4);
        expect(preview.lines).toEqual([120.5]);
        expect(preview.fractions).toEqual([]);
    });

    it("snaps the very top and bottom by fraction so both ends line up", () => {
        const sync = createScrollSync();
        const code = lineScroller(1);
        const preview = lineScroller(null);
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);
        sync.notify("code", 0);
        vi.advanceTimersByTime(100);
        sync.notify("code", 1);
        expect(preview.fractions).toEqual([0, 1]);
        expect(preview.lines).toEqual([]);
    });

    it("records the top line even while sync is off, and hands it over on a mode switch", () => {
        const sync = createScrollSync();
        const code = lineScroller(null);
        const preview = lineScroller(300);
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        // Reader mode: sync disabled, but the reader's place is remembered.
        sync.notify("preview", 0.5);
        expect(sync.lastTopLine("preview")).toBe(300);
        sync.handoff("preview", "code", { focus: true });
        expect(code.lines).toEqual([300]);
        expect(code.handoffs).toEqual([{ handoff: true, focus: true }]);
    });

    it("handoff does nothing when the source pane never reported a line", () => {
        const sync = createScrollSync();
        const code = lineScroller(null);
        sync.register("code", code.s);
        sync.handoff("preview", "code");
        expect(code.lines).toEqual([]);
        expect(code.fractions).toEqual([]);
    });
});

describe("offsetToLine / lineToOffset", () => {
    // Blocks at source lines 1, 5, 20 whose tops are at 0, 100, 400px; the
    // document ends at line 30 / 600px.
    const anchors: AnchorList = {
        count: 3,
        lineAt: (i) => [1, 5, 20][i],
        topAt: (i) => [0, 100, 400][i],
        endLine: 30,
        endTop: 600,
    };

    it("interpolates inside a block", () => {
        expect(offsetToLine(anchors, 0)).toBe(1);
        expect(offsetToLine(anchors, 50)).toBe(3);
        expect(offsetToLine(anchors, 250)).toBe(12.5);
        expect(offsetToLine(anchors, 500)).toBe(25);
    });

    it("is the inverse of lineToOffset", () => {
        for (const line of [1, 3, 5, 12.5, 20, 27]) {
            expect(offsetToLine(anchors, lineToOffset(anchors, line))).toBeCloseTo(line, 6);
        }
    });

    it("maps lines above the first block into the space above it (frontmatter card)", () => {
        const fm: AnchorList = { count: 1, lineAt: () => 5, topAt: () => 200, endLine: 10, endTop: 400 };
        expect(lineToOffset(fm, 1)).toBe(0);
        expect(lineToOffset(fm, 3)).toBe(100);
        expect(offsetToLine(fm, 100)).toBe(3);
    });
});
