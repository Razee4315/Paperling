import { describe, expect, it } from "vitest";
import { applyReaderEdit, readerEditRange, readerHtmlToMarkdown } from "./readerEdits";

describe("Reader block edits (READ-02)", () => {
    it("changes only the selected duplicate paragraph, preserving CRLF, frontmatter and diagrams", () => {
        const original = "---\r\ntitle: Keep\r\n---\r\n\r\nsame **text**\r\n\r\nsame **text**\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n";
        const range = readerEditRange(original, 7, 7, "P")!;
        expect(range.source).toBe("same **text**");
        const updated = applyReaderEdit(original, range, readerHtmlToMarkdown("<p>updated <strong>text</strong></p>", true));
        expect(updated).toBe(original.replace("\r\nsame **text**\r\n\r\n```", "\r\nupdated **text**\r\n\r\n```"));
    });
    it("refuses extended syntax rather than silently flattening it", () => {
        for (const source of ["text %%secret%%", "[[Note]]", "$x^2$", "[label][ref]", "![picture](a.png)", "==highlight==", "- [ ] task", "> [!tip] note", "# Heading {#id}", "[id]: /note", "word #tag", "<b>raw</b>", "x~sub~"]) {
            expect(readerEditRange(source, 1, 1, "P")).toBeNull();
        }
        expect(readerEditRange("table", 1, 1, "TABLE")).toBeNull();
        expect(readerEditRange("> ```mermaid\n> graph TD; A-->B\n> ```", 1, 3, "BLOCKQUOTE")).toBeNull();
        expect(readerEditRange("- item\n  | a | b |\n  | --- | --- |", 1, 3, "UL")).toBeNull();
        expect(readerEditRange("a", NaN, 1, "P")).toBeNull();
    });
    it("preserves headings, inline code, bold, italic, links, strike and nested lists in an edited block", () => {
        expect(readerHtmlToMarkdown('<h2>Title <strong>bold</strong></h2>', false)).toBe("## Title **bold**");
        expect(readerHtmlToMarkdown('<p><em>italic</em> <code>x</code> <del>old</del> <a href="https://example.com">link</a></p>', false)).toBe("*italic* `x` ~~old~~ [link](https://example.com)");
        expect(readerHtmlToMarkdown('<ul><li>first<ul><li>nested</li></ul></li><li>second</li></ul>', false)).toContain("nested");
    });
    it("rejects stale ranges and supports deletion without touching neighbors", () => {
        const range = readerEditRange("before\n\ntext\n\nafter", 3, 3, "P")!;
        expect(applyReaderEdit("a different document", range, "new")).toBeNull();
        expect(applyReaderEdit("before\n\ntext\n\nafter", range, "")).toBe("before\n\n\n\nafter");
    });
});
