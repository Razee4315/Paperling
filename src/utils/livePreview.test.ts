import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { livePreviewMarks } from "./livePreview";

/** Marks for `doc` with the caret on (1-based) `caretLine`. */
function marks(doc: string, caretLine: number) {
    let state = EditorState.create({ doc, extensions: [markdown()] });
    state = state.update({ selection: EditorSelection.cursor(state.doc.line(caretLine).from) }).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    const result = livePreviewMarks(state, 0, state.doc.length);
    return { hidden: result.hidden.map((range) => state.doc.sliceString(range.from, range.to)), headings: result.headings.map((h) => [state.doc.lineAt(h.pos).number, h.level]) };
}

describe("live preview marks (LIVE-01)", () => {
    const doc = "# Title\n\nSome **bold** and *italic* with `code` and a [link](https://example.com).\n\n## Next ##\n\nlast line";

    it("hides heading, emphasis, inline-code and link syntax on lines the caret is not on", () => {
        const { hidden, headings } = marks(doc, 7);
        expect(hidden).toEqual(["# ", "**", "**", "*", "*", "`", "`", "[", "](https://example.com)", "## "]);
        expect(headings).toEqual([[1, 1], [5, 2]]);
    });
    it("shows the raw source on the caret's line and keeps heading sizing there", () => {
        const onParagraph = marks(doc, 3);
        expect(onParagraph.hidden).toEqual(["# ", "## "]);
        const onTitle = marks(doc, 1);
        expect(onTitle.hidden).not.toContain("# ");
        expect(onTitle.headings).toEqual([[1, 1], [5, 2]]);
    });
    it("leaves code blocks, images, reference links, lists and Setext headings as typed", () => {
        const literal = "```\n# not a heading **x**\n```\n\n![alt](img.png)\n\n[ref][id]\n\n- item\n\nSetext\n======\n\nend";
        expect(marks(literal, 14).hidden).toEqual([]);
    });
    it("reveals every line a multi-line selection touches", () => {
        let state = EditorState.create({ doc, extensions: [markdown()] });
        state = state.update({ selection: EditorSelection.range(0, state.doc.line(3).to) }).state;
        ensureSyntaxTree(state, state.doc.length, 5000);
        const hidden = livePreviewMarks(state, 0, state.doc.length).hidden.map((range) => state.doc.sliceString(range.from, range.to));
        expect(hidden).toEqual(["## "]);
    });
});
