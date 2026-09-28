import { describe, it, expect } from "vitest";
import { pasteUrlOnSelection, pasteUrlAutolink, pasteTsvAsTable } from "./smartPaste";
import type { EditorState } from "./editorActions";

const st = (text: string, selStart: number, selEnd: number = selStart): EditorState => ({ text, selStart, selEnd });

describe("pasteUrlOnSelection", () => {
    it("wraps the selection as a markdown link when a URL is pasted", () => {
        const r = pasteUrlOnSelection(st("click", 0, 5), "https://x.com");
        expect(r?.text).toBe("[click](https://x.com)");
    });
    it("returns null with no selection", () => {
        expect(pasteUrlOnSelection(st("click", 0, 0), "https://x.com")).toBeNull();
    });
    it("returns null when the paste is not a URL", () => {
        expect(pasteUrlOnSelection(st("click", 0, 5), "not a url")).toBeNull();
    });
});

describe("pasteUrlAutolink", () => {
    it("autolinks a pasted URL on an empty selection", () => {
        const r = pasteUrlAutolink(st("", 0), "https://x.com");
        expect(r?.text).toBe("<https://x.com>");
    });
    it("returns null when there is a selection", () => {
        expect(pasteUrlAutolink(st("ab", 0, 2), "https://x.com")).toBeNull();
    });
});

describe("pasteTsvAsTable", () => {
    it("converts tab-separated rows into a GFM table", () => {
        const r = pasteTsvAsTable(st("", 0), "a\tb\nc\td");
        expect(r?.text).toContain("| a | b |");
        expect(r?.text).toContain("| --- | --- |");
        expect(r?.text).toContain("| c | d |");
    });
    it("returns null without tabs", () => {
        expect(pasteTsvAsTable(st("", 0), "no tabs here")).toBeNull();
    });
    it("returns null for a single column", () => {
        expect(pasteTsvAsTable(st("", 0), "onlyonecol")).toBeNull();
    });
});
