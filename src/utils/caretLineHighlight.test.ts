import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { highlightCaretLine } from "./caretLineHighlight";
import { installCodeMirrorDomPolyfills } from "../test/codemirrorDom";

beforeAll(installCodeMirrorDomPolyfills);

let view: EditorView | null = null;
afterEach(() => {
    view?.destroy();
    view = null;
});

/** Mount a two-line document with the given selection. */
function mount(selection: { anchor: number; head?: number }) {
    view = new EditorView({
        state: EditorState.create({
            doc: "first line\nsecond line",
            selection,
            extensions: [highlightCaretLine],
        }),
        parent: document.body,
    });
    return view;
}

const activeLines = (v: EditorView) => v.dom.querySelectorAll(".cm-activeLine").length;

describe("highlightCaretLine", () => {
    it("marks the caret's line when nothing is selected", () => {
        expect(activeLines(mount({ anchor: 3 }))).toBe(1);
    });

    it("marks no line while text is selected, so the tint can't hide it (#146)", () => {
        expect(activeLines(mount({ anchor: 2, head: 6 }))).toBe(0);
    });

    it("drops the highlight as soon as a selection is made, and restores it after", () => {
        const v = mount({ anchor: 3 });
        expect(activeLines(v)).toBe(1);

        // Select backwards across the line break: the head lands on line 1, the
        // exact case where CodeMirror's own highlighter would still decorate.
        v.dispatch({ selection: { anchor: 15, head: 2 } });
        expect(activeLines(v)).toBe(0);

        v.dispatch({ selection: { anchor: 4 } });
        expect(activeLines(v)).toBe(1);
    });

    it("decorates a shared line only once for multiple cursors", () => {
        // Two cursors on line 1, one on line 2 — a duplicate line decoration
        // would throw, so this pins the dedupe as much as the count.
        view = new EditorView({
            state: EditorState.create({
                doc: "first line\nsecond line",
                selection: EditorSelection.create(
                    [EditorSelection.cursor(2), EditorSelection.cursor(5), EditorSelection.cursor(14)],
                    0,
                ),
                extensions: [highlightCaretLine, EditorState.allowMultipleSelections.of(true)],
            }),
            parent: document.body,
        });
        expect(activeLines(view)).toBe(2);
    });
});
