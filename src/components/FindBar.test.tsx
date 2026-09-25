import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { FindBar, type FindController, type FindResult } from "./FindBar";

// A recording mock controller. `results` maps a query to the match set it finds
// so tests can assert what got searched/painted without a real editor or DOM.
function mockController(over: Partial<FindController> = {}): FindController & {
    calls: string[];
    lastSearch: string | null;
} {
    const rec = { calls: [] as string[], lastSearch: null as string | null };
    return {
        calls: rec.calls,
        get lastSearch() { return rec.lastSearch; },
        supportsReplace: false,
        supportsRegex: false,
        isValidPattern: () => true,
        search: vi.fn((query: string): FindResult => {
            rec.calls.push(`search:${query}`);
            rec.lastSearch = query;
            // Pretend a 1-char query finds 3 hits, a 2-char query finds 1.
            const count = query.length === 1 ? 3 : query.length >= 2 ? 1 : 0;
            return { count, activeIndex: count ? 0 : -1 };
        }),
        setActive: vi.fn((i: number) => rec.calls.push(`setActive:${i}`)),
        clear: vi.fn(() => rec.calls.push("clear")),
        ...over,
    } as FindController & { calls: string[]; lastSearch: string | null };
}

describe("FindBar", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { cleanup(); vi.useRealTimers(); });

    const type = (value: string) =>
        act(() => { fireEvent.change(screen.getByLabelText("Find text"), { target: { value } }); });

    it("debounces the search briefly (search-as-you-type) and only searches the settled query", () => {
        const c = mockController();
        render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} />);

        type("o");
        // Before the debounce elapses, nothing has been searched yet.
        act(() => { vi.advanceTimersByTime(50); });
        expect(c.search).not.toHaveBeenCalled();

        // Keep typing inside the window: the pending "o" search is cancelled.
        type("of");
        act(() => { vi.advanceTimersByTime(89); });
        expect(c.search).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(1); });
        expect(c.search).toHaveBeenCalledTimes(1);
        expect(c.lastSearch).toBe("of"); // never searched the intermediate "o"
    });

    it("re-searches lazily when only the document changed (FIND-09)", () => {
        const c = mockController();
        const { rerender } = render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} />);
        type("of");
        act(() => { vi.advanceTimersByTime(90); });
        expect(c.search).toHaveBeenCalledTimes(1);
        rerender(<FindBar isOpen controller={c} revision={1} onClose={() => {}} />);
        act(() => { vi.advanceTimersByTime(200); });
        expect(c.search).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(150); });
        expect(c.search).toHaveBeenCalledTimes(2);
    });

    it("an open request seeds the query from the selection (FIND-06)", () => {
        const c = mockController();
        const { rerender } = render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} openRequest={{ nonce: 0 }} />);
        rerender(<FindBar isOpen controller={c} revision={0} onClose={() => {}} openRequest={{ nonce: 1, text: "answer" }} />);
        expect((screen.getByLabelText("Find text") as HTMLInputElement).value).toBe("answer");
        // A request without a selection keeps the previous query.
        rerender(<FindBar isOpen controller={c} revision={0} onClose={() => {}} openRequest={{ nonce: 2 }} />);
        expect((screen.getByLabelText("Find text") as HTMLInputElement).value).toBe("answer");
    });

    it("clears previous highlights the instant the query changes", () => {
        const c = mockController();
        render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} />);

        type("of");
        act(() => { vi.advanceTimersByTime(400); });
        c.calls.length = 0;

        // Changing the query clears immediately, before any new search runs.
        type("ox");
        expect(c.calls).toContain("clear");
        expect(c.calls.some((x) => x.startsWith("search:"))).toBe(false); // debounce hasn't fired yet
    });

    it("ends with only the settled query highlighted", () => {
        const c = mockController();
        render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} />);

        type("of");
        act(() => { vi.advanceTimersByTime(400); });

        expect(c.search).toHaveBeenCalledTimes(1);
        expect(c.lastSearch).toBe("of");
        expect(screen.getByText("1 of 1")).toBeInTheDocument();
    });

    it("clears highlights when it closes", () => {
        const c = mockController();
        const { rerender } = render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} />);
        type("of");
        act(() => { vi.advanceTimersByTime(400); });
        c.calls.length = 0;

        rerender(<FindBar isOpen={false} controller={c} revision={0} onClose={() => {}} />);
        expect(c.calls).toContain("clear");
    });

    it("hides replace and regex when the controller doesn't support them", () => {
        const c = mockController({ supportsReplace: false, supportsRegex: false });
        render(<FindBar isOpen controller={c} revision={0} onClose={() => {}} />);
        expect(screen.queryByLabelText("Replace with")).not.toBeInTheDocument();
        expect(screen.queryByTitle("Regex")).not.toBeInTheDocument();
        expect(screen.getByTitle("Match case")).toBeInTheDocument();
    });

    it("shows replace and regex when the controller supports them", () => {
        const c = mockController({ supportsReplace: true, supportsRegex: true });
        render(<FindBar isOpen initialMode="replace" controller={c} revision={0} onClose={() => {}} />);
        expect(screen.getByLabelText("Replace with")).toBeInTheDocument();
        expect(screen.getByTitle("Regex")).toBeInTheDocument();
    });
});

describe("findSeedFromSelection", () => {
    it("accepts a one-line selection and rejects blank, multi-line or huge ones", async () => {
        const { findSeedFromSelection } = await import("./FindBar");
        expect(findSeedFromSelection("answer")).toBe("answer");
        expect(findSeedFromSelection("  ")).toBeUndefined();
        expect(findSeedFromSelection("a\nb")).toBeUndefined();
        expect(findSeedFromSelection("x".repeat(201))).toBeUndefined();
        expect(findSeedFromSelection(undefined)).toBeUndefined();
    });
});
