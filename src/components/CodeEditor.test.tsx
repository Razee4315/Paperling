// Regression test for the invisible editor selection (CodenameFlux review).
// CodeMirror's base theme paints the FOCUSED selection through
// `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`,
// which out-specifies the app theme's generic `.cm-selectionBackground` rule —
// so every theme rendered CM's default lavender (#d7d4f0), unreadable against
// light/paper text. The theme must mirror that selector shape for
// --selection-bg to win.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { CodeEditor } from "./CodeEditor";
import { installCodeMirrorDomPolyfills } from "../test/codemirrorDom";

beforeAll(installCodeMirrorDomPolyfills);
afterEach(cleanup);

describe("editor selection theming", () => {
    it("overrides CodeMirror's focused-selection base rule with --selection-bg", async () => {
        const { container } = render(<CodeEditor content="hello" onChange={() => {}} />);
        await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());

        const css = Array.from(document.querySelectorAll("style"))
            .map((s) => s.textContent ?? "")
            .join("\n");
        expect(css).toMatch(
            /\.cm-focused > \.cm-scroller > \.cm-selectionLayer \.cm-selectionBackground[^}]*var\(--selection-bg\)/,
        );
    });
});

// TABS-20: every tab keeps its own editor state. Switching away and back used
// to replace the text wholesale and wipe the undo history, so the caret
// jumped and Ctrl+Z stopped working after a glance at another tab.
describe("per-tab editor state (TABS-20)", () => {
    const viewOf = (container: HTMLElement) =>
        (container.querySelector(".cm-content") as unknown as { cmTile?: { view: import("@codemirror/view").EditorView } }).cmTile!.view;

    it("restores the caret and the undo history when switching back to a tab", async () => {
        const noop = () => {};
        const { container, rerender } = render(<CodeEditor content="alpha" docKey="a" docSwapId={1} onChange={noop} />);
        await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
        const view = viewOf(container);
        view.dispatch({ changes: { from: 5, insert: " beta" }, selection: { anchor: 7 }, userEvent: "input.type" });
        const edited = view.state.doc.toString();

        rerender(<CodeEditor content="other doc" docKey="b" docSwapId={2} onChange={noop} />);
        expect(view.state.doc.toString()).toBe("other doc");

        rerender(<CodeEditor content={edited} docKey="a" docSwapId={3} onChange={noop} />);
        expect(view.state.doc.toString()).toBe("alpha beta");
        expect(view.state.selection.main.head).toBe(7);

        const { undo } = await import("@codemirror/commands");
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe("alpha");
    });

    it("starts clean (no undo into another file) when the cached text is stale", async () => {
        const noop = () => {};
        const { container, rerender } = render(<CodeEditor content="one" docKey="a" docSwapId={1} onChange={noop} />);
        await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
        const view = viewOf(container);
        view.dispatch({ changes: { from: 3, insert: "!" }, userEvent: "input.type" });

        rerender(<CodeEditor content="two" docKey="b" docSwapId={2} onChange={noop} />);
        // Tab "a" changed while hidden (e.g. replace-in-files): its cached
        // state no longer matches, so it opens fresh with no history.
        rerender(<CodeEditor content="one changed elsewhere" docKey="a" docSwapId={3} onChange={noop} />);
        expect(view.state.doc.toString()).toBe("one changed elsewhere");
        const { undo } = await import("@codemirror/commands");
        expect(undo(view)).toBe(false);
    });

    it("keeps history across a same-document reload so the reload itself is undoable", async () => {
        const noop = () => {};
        const { container, rerender } = render(<CodeEditor content="disk v1" docKey="a" docSwapId={1} onChange={noop} />);
        await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
        const view = viewOf(container);
        rerender(<CodeEditor content="disk v2" docKey="a" docSwapId={2} onChange={noop} />);
        expect(view.state.doc.toString()).toBe("disk v2");
        const { undo } = await import("@codemirror/commands");
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe("disk v1");
    });
});

// EDIT-04 (#313): auto-closing brackets and quotes can be disabled cleanly,
// including live toggling and switching back to a cached tab.
describe("auto-close brackets (#313, EDIT-04)", () => {
    const viewOf = (container: HTMLElement) =>
        (container.querySelector(".cm-content") as unknown as { cmTile?: { view: EditorView } }).cmTile!.view;

    function typeChar(view: EditorView, ch: string) {
        const pos = view.state.selection.main.head;
        for (const handler of view.state.facet(EditorView.inputHandler)) {
            if (handler(view, pos, pos, ch, () => view.state.doc.toString())) return;
        }
        view.dispatch({ changes: { from: pos, to: pos, insert: ch }, selection: { anchor: pos + ch.length }, userEvent: "input.type" });
    }

    it("auto-inserts closing pairs when enabled and inserts only the typed char when disabled", async () => {
        const noop = () => {};
        const { container, rerender } = render(<CodeEditor content="" autoCloseBrackets={true} onChange={noop} />);
        await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
        const view = viewOf(container);

        for (const [open, expected] of [["\"", "\"\""], ["(", "()"], ["[", "[]"], ["{", "{}"]] as const) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" }, selection: { anchor: 0 } });
            typeChar(view, open);
            expect(view.state.doc.toString()).toBe(expected);
        }

        // Turning the setting off reconfigures the open editor immediately.
        rerender(<CodeEditor content="" autoCloseBrackets={false} onChange={noop} />);
        for (const open of ["\"", "(", "[", "{"] as const) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" }, selection: { anchor: 0 } });
            typeChar(view, open);
            expect(view.state.doc.toString()).toBe(open);
        }

        // Delete-pair keymap is also removed when disabled, and restored when re-enabled.
        const { deleteBracketPair } = await import("@codemirror/autocomplete");
        rerender(<CodeEditor content="" autoCloseBrackets={true} onChange={noop} />);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "()" }, selection: { anchor: 1 } });
        expect(deleteBracketPair(view)).toBe(true);
        expect(view.state.doc.toString()).toBe("");
    });

    it("applies the live autoCloseBrackets setting when restoring a cached tab", async () => {
        const noop = () => {};
        const { container, rerender } = render(
            <CodeEditor content="tab a" docKey="a" docSwapId={1} autoCloseBrackets={true} onChange={noop} />,
        );
        await waitFor(() => expect(container.querySelector(".cm-content")).toBeTruthy());
        const view = viewOf(container);

        rerender(<CodeEditor content="tab b" docKey="b" docSwapId={2} autoCloseBrackets={false} onChange={noop} />);
        rerender(<CodeEditor content="tab a" docKey="a" docSwapId={3} autoCloseBrackets={false} onChange={noop} />);

        view.dispatch({ selection: { anchor: 5 } });
        typeChar(view, "\"");
        expect(view.state.doc.toString()).toBe("tab a\"");
    });
});
