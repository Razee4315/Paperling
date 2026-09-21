import { describe, it, expect } from "vitest";
import {
    handleTab,
    handleEnter,
    handleAutoPair,
    handleSkipCloser,
    handleBackspace,
    wrapSelection,
    insertLink,
    type EditorState,
} from "./editorActions";

const st = (text: string, selStart: number, selEnd: number = selStart): EditorState => ({ text, selStart, selEnd });

describe("handleAutoPair", () => {
    it("inserts a closing pair on empty selection and centers the caret", () => {
        const r = handleAutoPair(st("", 0), "(");
        expect(r).toEqual({ text: "()", selStart: 1, selEnd: 1 });
    });

    it("wraps a non-empty selection", () => {
        const r = handleAutoPair(st("abc", 0, 3), "(");
        expect(r).toEqual({ text: "(abc)", selStart: 1, selEnd: 4 });
    });

    it("does not auto-pair a quote next to a word char (apostrophe)", () => {
        expect(handleAutoPair(st("a", 1), "'")).toBeNull();
    });

    it("returns null for a non-pairing char", () => {
        expect(handleAutoPair(st("", 0), "z")).toBeNull();
    });
});

describe("handleSkipCloser", () => {
    it("types past an existing closer", () => {
        expect(handleSkipCloser(st("()", 1), ")")).toEqual({ text: "()", selStart: 2, selEnd: 2 });
    });
    it("returns null when next char is not the closer", () => {
        expect(handleSkipCloser(st("(", 1), ")")).toBeNull();
    });
});

describe("handleBackspace", () => {
    it("erases an empty auto-pair as a unit", () => {
        expect(handleBackspace(st("()", 1))).toEqual({ text: "", selStart: 0, selEnd: 0 });
    });
    it("returns null for normal backspace", () => {
        expect(handleBackspace(st("ab", 2))).toBeNull();
    });
});

describe("wrapSelection", () => {
    it("wraps a selection with markers", () => {
        expect(wrapSelection(st("bold", 0, 4), "**", "**")).toEqual({ text: "**bold**", selStart: 2, selEnd: 6 });
    });
    it("toggles (unwraps) an already-wrapped selection", () => {
        // selecting "bold" inside "**bold**"
        expect(wrapSelection(st("**bold**", 2, 6), "**", "**")).toEqual({ text: "bold", selStart: 0, selEnd: 4 });
    });
});

describe("insertLink", () => {
    it("uses a pasted-looking URL as the href and puts caret in the text slot", () => {
        const r = insertLink(st("https://x.com", 0, 13));
        expect(r.text).toBe("[](https://x.com)");
        expect(r.selStart).toBe(1);
    });
    it("treats plain selection as link text and selects the url placeholder", () => {
        const r = insertLink(st("click", 0, 5));
        expect(r.text).toBe("[click](url)");
        expect(r.text.slice(r.selStart, r.selEnd)).toBe("url");
    });
});

describe("handleEnter", () => {
    it("continues a bullet list", () => {
        expect(handleEnter(st("- a", 3))?.text).toBe("- a\n- ");
    });
    it("increments a numbered list", () => {
        expect(handleEnter(st("1. a", 4))?.text).toBe("1. a\n2. ");
    });
    it("terminates an empty list item", () => {
        expect(handleEnter(st("- ", 2))?.text).toBe("\n");
    });
    it("continues a blockquote", () => {
        expect(handleEnter(st("> hi", 4))?.text).toBe("> hi\n> ");
    });
    it("returns null on a plain line", () => {
        expect(handleEnter(st("plain", 5))).toBeNull();
    });
});

describe("handleTab", () => {
    it("inserts indent on a single line", () => {
        expect(handleTab(st("abc", 0), false)).toEqual({ text: "  abc", selStart: 2, selEnd: 2 });
    });
    it("indents every line of a multi-line selection", () => {
        const r = handleTab(st("a\nb", 0, 3), false);
        expect(r?.text).toBe("  a\n  b");
    });
    it("outdents with shift", () => {
        const r = handleTab(st("  abc", 2), true);
        expect(r?.text).toBe("abc");
    });
    it("moves to the next table cell", () => {
        // "| a | b |" — caret in first cell -> jumps into second cell
        const r = handleTab(st("| a | b |", 2), false);
        expect(r?.selStart).toBe(6);
    });
});

describe("audit regression fixes", () => {
    it("Tab with a single-line selection indents the line and KEEPS the selection (SHC-04)", () => {
        const r = handleTab(st("hello world", 6, 11), false);
        expect(r?.text).toBe("  hello world");
        expect(r?.selStart).toBe(8);
        expect(r?.selEnd).toBe(13);
    });

    it("Tab on the last cell of a table that ends the document creates a new row (SHC-05)", () => {
        const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
        // caret on the "2" — inside the LAST cell (between the last two pipes)
        const r = handleTab(st(doc, doc.length - 3), false);
        expect(r?.text).toBe(doc + "\n|  |  |");
        expect(r?.selStart).toBe(doc.length + 3);
    });

    it("Tab on the last cell before a trailing newline appends a row before it (SHC-05)", () => {
        const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
        const r = handleTab(st(doc, doc.length - 4), false);
        expect(r?.text).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n");
    });

    it("Enter on a numbered list renumbers the items below (SHC-06)", () => {
        const r = handleEnter(st("1. one\n2. two\n3. three", 6), false);
        expect(r?.text).toBe("1. one\n2. \n3. two\n4. three");
    });

    it("Enter renumbering stops at a broken chain (SHC-06)", () => {
        const r = handleEnter(st("1. one\n2. two\n\n9. nine", 6), false);
        expect(r?.text).toBe("1. one\n2. \n3. two\n\n9. nine");
    });

    it("Enter on a numbered list at EOF adds no stray trailing newline (SHC-06)", () => {
        expect(handleEnter(st("1. one", 6))?.text).toBe("1. one\n2. ");
        expect(handleEnter(st("1. one\n", 6))?.text).toBe("1. one\n2. \n");
    });

    it("wrapSelection unwraps markers INSIDE the selection (SHC-07)", () => {
        const r = wrapSelection(st("**bold**", 0, 8), "**");
        expect(r.text).toBe("bold");
        expect(r.selStart).toBe(0);
        expect(r.selEnd).toBe(4);
    });

    it("wrapSelection still unwraps markers OUTSIDE the selection", () => {
        const r = wrapSelection(st("**bold**", 2, 6), "**");
        expect(r.text).toBe("bold");
    });

    it("handleTableTab: shift-tab from the first body cell skips the separator to the header row", () => {
        const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
        // caret on the "1" (first cell of the body row)
        const r = handleTab(st(doc, 26), true);
        expect(r?.selStart).toBe(6); // second cell of the header row
    });
});
