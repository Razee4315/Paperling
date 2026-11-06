import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { changeCase, formatNow, sortLines, textCommandSpec, type TextCommandId } from "./textCommands";

const NOW = new Date(2026, 9, 31, 14, 5);

function run(doc: string, anchor: number, head: number, id: TextCommandId) {
    const state = EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    const spec = textCommandSpec(state, id, NOW);
    if (!spec) return null;
    return state.update(spec).state;
}

describe("sortLines", () => {
    it("sorts naturally and ignores case", () => {
        expect(sortLines("item 10\nitem 2\nApple\nbanana", "asc")).toBe("Apple\nbanana\nitem 2\nitem 10");
    });
    it("sorts descending", () => {
        expect(sortLines("a\nc\nb", "desc")).toBe("c\nb\na");
    });
    it("drops exact duplicates", () => {
        expect(sortLines("b\na\nb\nA", "unique")).toBe("a\nA\nb");
    });
});

describe("changeCase", () => {
    it("handles the three modes", () => {
        expect(changeCase("Hello World", "upper")).toBe("HELLO WORLD");
        expect(changeCase("Hello World", "lower")).toBe("hello world");
        expect(changeCase("hello wORLD (again) e-mail", "title")).toBe("Hello World (Again) E-Mail");
    });
    it("works outside ASCII", () => {
        expect(changeCase("élan vital", "title")).toBe("Élan Vital");
    });
});

describe("formatNow", () => {
    it("is ISO ordered and zero padded", () => {
        expect(formatNow("date", new Date(2026, 0, 5, 3, 7))).toBe("2026-01-05");
        expect(formatNow("datetime", new Date(2026, 0, 5, 3, 7))).toBe("2026-01-05 03:07");
    });
});

describe("textCommandSpec", () => {
    it("sorts whole lines even when the selection starts mid-line", () => {
        const state = run("keep\nc\nb\na\nkeep", 6, 10, "sortAsc");
        expect(state?.doc.toString()).toBe("keep\na\nb\nc\nkeep");
    });

    it("leaves out a line the selection only touches at its start", () => {
        const state = run("b\na\nz", 0, 4, "sortAsc");
        expect(state?.doc.toString()).toBe("a\nb\nz");
    });

    it("needs two lines to sort", () => {
        expect(run("one line", 0, 8, "sortAsc")).toBeNull();
        expect(run("a\nb", 1, 1, "sortAsc")).toBeNull();
    });

    it("changes the word at the caret when nothing is selected", () => {
        const state = run("hello world", 7, 7, "upper");
        expect(state?.doc.toString()).toBe("hello WORLD");
    });

    it("changes every selected range and keeps it selected after the length changes", () => {
        const state = EditorState.create({
            doc: "straße straße",
            selection: EditorSelection.create([EditorSelection.range(0, 6), EditorSelection.range(7, 13)]),
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });
        const next = state.update(textCommandSpec(state, "upper", NOW)!).state;
        expect(next.doc.toString()).toBe("STRASSE STRASSE");
        expect(next.selection.ranges.map((r) => next.sliceDoc(r.from, r.to))).toEqual(["STRASSE", "STRASSE"]);
    });

    it("has nothing to change on an empty line", () => {
        expect(run("a\n\nb", 2, 2, "upper")).toBeNull();
    });

    it("inserts the date over the selection", () => {
        expect(run("on TODAY.", 3, 8, "date")?.doc.toString()).toBe("on 2026-10-31.");
        expect(run("", 0, 0, "datetime")?.doc.toString()).toBe("2026-10-31 14:05");
    });

    it("inserts a table of contents at the caret", () => {
        const doc = "# Title\n\n\n\n## One\n\n## Two\n";
        expect(run(doc, 9, 9, "toc")?.doc.toString()).toContain("- [One](#one)\n- [Two](#two)");
    });

    it("needs headings for a table of contents", () => {
        expect(run("plain text", 0, 0, "toc")).toBeNull();
    });
});
