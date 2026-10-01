import { describe, expect, it } from "vitest";
import { applyReaderChange, applyReaderEdit, readerChange, readerEditRange, readerHtmlToMarkdown, readerIslands } from "./readerEdits";

describe("Reader block edits (READ-02)", () => {
    it("changes only the selected duplicate paragraph, preserving CRLF, frontmatter and diagrams", () => {
        const original = "---\r\ntitle: Keep\r\n---\r\n\r\nsame **text**\r\n\r\nsame **text**\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n";
        const range = readerEditRange(original, 7, 7, "P")!;
        expect(range.source).toBe("same **text**");
        const updated = applyReaderEdit(original, range, readerHtmlToMarkdown("<p>updated <strong>text</strong></p>", true));
        expect(updated).toBe(original.replace("\r\nsame **text**\r\n\r\n```", "\r\nupdated **text**\r\n\r\n```"));
    });
    it("refuses extended syntax rather than silently flattening it", () => {
        for (const source of ["text %%secret%%", "![[embed.png]]", "$$x^2$$", "[label][ref]", "![picture](a.png)", "note[^1]", "> [!tip] note", "# Heading {#id}", "[id]: /note", "<b>raw</b>", "x~sub~"]) {
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
    it("writes single-space list markers so an edit does not respace the list (READ-04)", () => {
        expect(readerHtmlToMarkdown("<ol><li>one more</li><li>inserted</li><li>two</li></ol>", false)).toBe("1. one more\n2. inserted\n3. two");
        expect(readerHtmlToMarkdown('<ol start="4"><li>four</li><li>five</li></ol>', false)).toBe("4. four\n5. five");
        expect(readerHtmlToMarkdown("<ul><li>first<ul><li>nested</li></ul></li><li>second</li></ul>", false)).toBe("- first\n  - nested\n- second");
    });
    it("finds wikilinks, tags, highlights, inline math and task boxes as islands, in source order (READ-05)", () => {
        const source = "- [ ] ship [[Roadmap|the plan]] #work\n- [X] $a+b$ then ==done==";
        expect(readerIslands(source).map((island) => [island.kind, island.text])).toEqual([
            ["task", "[ ]"], ["wikilink", "[[Roadmap|the plan]]"], ["tag", "#work"],
            ["task", "[X]"], ["math", "$a+b$"], ["highlight", "==done=="],
        ]);
        expect(readerEditRange(source, 1, 2, "UL")?.source).toBe(source);
        // Code spans, escapes, embeds and math keep their contents out of the list.
        expect(readerIslands("`[[code]]` \\#nope ![[img.png]] $[[x]]$ a#b").map((island) => island.text)).toEqual(["$[[x]]$"]);
        expect(readerIslands("# Heading\n\nA price of $5 and $6.")).toEqual([]);
    });
    it("writes an island back as its exact source while the text around it changes (READ-05)", () => {
        const html = '<p>See <a data-wikilink="Roadmap" data-md-src="[[Roadmap|the plan]]" contenteditable="false">the plan</a> today <span class="md-tag" data-md-src="#work">#work</span></p>';
        expect(readerHtmlToMarkdown(html, false)).toBe("See [[Roadmap|the plan]] today #work");
        const list = '<ul><li><input type="checkbox" data-md-src="[X]"> shipped <mark data-md-src="==fast==">fast</mark></li><li>plain</li></ul>';
        expect(readerHtmlToMarkdown(list, false)).toBe("- [X] shipped ==fast==\n- plain");
        // A box the browser left glued to its text still saves as a task.
        expect(readerHtmlToMarkdown('<ul><li><input type="checkbox" data-md-src="[ ]">new one</li></ul>', false)).toBe("- [ ] new one");
    });
    it("rejects stale ranges and supports deletion without touching neighbors", () => {
        const range = readerEditRange("before\n\ntext\n\nafter", 3, 3, "P")!;
        expect(applyReaderEdit("a different document", range, "new")).toBeNull();
        expect(applyReaderEdit("before\n\ntext\n\nafter", range, "")).toBe("before\n\n\n\nafter");
    });
    it("allows literal punctuation in real code spans and escapes, retaining extension protection", () => {
        for (const source of ["Compare `x < y` and `$literal`.", "Use ``a ` < b`` here.", "A price of $5.", "A plain x < y comparison.", "Escaped \\<b> text."]) {
            expect(readerEditRange(source, 1, 1, "P")?.source).toBe(source);
        }
        for (const source of ["Real <b>HTML</b>", "Display $$x^2$$ math.", "![[Embed]] next to `safe`", "%%hidden%% next to `<code>`"]) {
            expect(readerEditRange(source, 1, 1, "P")).toBeNull();
        }
    });
    it("stores a small guarded undo diff and restores CRLF without touching neighboring blocks", () => {
        const before = "---\r\ntitle: Keep\r\n---\r\n\r\n# Heading\r\n\r\nSame text\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n```";
        const after = before.replace("Same text", "Same changed text");
        const change = readerChange(before, after)!;
        expect(change.before.length + change.after.length).toBeLessThan(20);
        expect(applyReaderChange(before, change)).toBe(after);
        expect(applyReaderChange(after, change, true)).toBe(before);
        expect(applyReaderChange(after.replace("changed", "external"), change, true)).toBeNull();
        expect(readerChange(before, before)).toBeNull();
    });
});
