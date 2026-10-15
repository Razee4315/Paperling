import { describe, it, expect } from "vitest";
import { splitMarkdownBlocks } from "./markdownBlocks";

const texts = (body: string) => splitMarkdownBlocks(body, 0)?.map((b) => b.text);

describe("splitMarkdownBlocks (PERF-02)", () => {
    it("splits top-level blocks at blank lines and records each block's line offset", () => {
        const blocks = splitMarkdownBlocks("# Title\n\nPara one\nstill one\n\n\nPara two", 0)!;
        expect(blocks.map((b) => b.text)).toEqual(["# Title", "Para one\nstill one", "Para two"]);
        expect(blocks.map((b) => b.lineOffset)).toEqual([0, 2, 6]);
    });

    it("never splits inside fenced code, even across blank lines", () => {
        const md = "```js\nconst a = 1;\n\n\nconst b = 2;\n```\n\nafter";
        expect(texts(md)).toEqual(["```js\nconst a = 1;\n\n\nconst b = 2;\n```", "after"]);
        // A longer fence is only closed by a fence at least as long.
        expect(texts("````\n```\n\nx\n````\n\ny")).toEqual(["````\n```\n\nx\n````", "y"]);
        expect(texts("~~~\n\n~~~\n\nz")).toEqual(["~~~\n\n~~~", "z"]);
    });

    it("keeps $$ math blocks and HTML comments whole", () => {
        expect(texts("$$\na\n\nb\n$$\n\nnext")).toEqual(["$$\na\n\nb\n$$", "next"]);
        expect(texts("$$x$$\n\nnext")).toEqual(["$$x$$", "next"]);
        expect(texts("<!-- one\n\ntwo -->\n\nnext")).toEqual(["<!-- one\n\ntwo -->", "next"]);
    });

    it("keeps raw-HTML containers like <details> together with their markdown body", () => {
        const md = "<details>\n<summary>More</summary>\n\n- hidden item\n\n</details>\n\nafter";
        expect(texts(md)).toEqual(["<details>\n<summary>More</summary>\n\n- hidden item\n\n</details>", "after"]);
    });

    it("does not split lists (loose items, nested continuations) or definition lists", () => {
        expect(texts("- a\n\n- b\n\n  more b\n\nend")).toEqual(["- a\n\n- b\n\n  more b", "end"]);
        expect(texts("1. a\n\n2. b")).toEqual(["1. a\n\n2. b"]);
        expect(texts("Term\n\n: definition")).toEqual(["Term\n\n: definition"]);
        // Indented code after a paragraph stays attached.
        expect(texts("para\n\n    code\n\nnext")).toEqual(["para\n\n    code", "next"]);
    });

    it("gives unchanged blocks the same key when blocks above them change", () => {
        const before = splitMarkdownBlocks("intro\n\n## Keep\n\nbody", 0)!;
        const after = splitMarkdownBlocks("intro edited\nwith a new line\n\n## Keep\n\nbody", 0)!;
        expect(after[1].key).toBe(before[1].key);
        expect(after[2].key).toBe(before[2].key);
        expect(after[0].key).not.toBe(before[0].key);
        expect(after[1].lineOffset).toBe(before[1].lineOffset + 1);
    });

    it("keys identical blocks by occurrence so React keys stay unique", () => {
        const keys = splitMarkdownBlocks("---\n\ntext\n\n---", 0)!.map((b) => b.key);
        expect(new Set(keys).size).toBe(3);
    });

    it("renders footnote documents whole (footnotes number across the document)", () => {
        expect(splitMarkdownBlocks("See[^1].\n\n[^1]: note")).toBeNull();
    });

    it("appends link reference definitions to blocks that might use them", () => {
        const blocks = splitMarkdownBlocks("Read [the docs][d].\n\nNo links here.\n\n[d]: https://example.com", 0)!;
        expect(blocks[0].text).toBe("Read [the docs][d].\n\n[d]: https://example.com");
        expect(blocks[1].text).toBe("No links here.");
    });

    it("groups blocks into section chunks that start at headings", () => {
        const md = "intro\n\nmore intro\n\n## A\n\na1\n\na2\n\n## B\n\nb1";
        const chunks = splitMarkdownBlocks(md)!;
        expect(chunks.map((c) => c.text)).toEqual(["intro\n\nmore intro", "## A\n\na1\n\na2", "## B\n\nb1"]);
        expect(chunks.map((c) => c.lineOffset)).toEqual([0, 4, 10]);
    });

    it("caps a long section so an edit re-renders a bounded chunk, without shifting other chunks", () => {
        const para = (i: number) => `para ${i} ${"x".repeat(400)}`;
        const body = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
        const chunks = splitMarkdownBlocks(body)!;
        expect(chunks.length).toBeGreaterThan(3);
        // Editing the last paragraph leaves every earlier chunk's key alone.
        const edited = splitMarkdownBlocks(body.replace(para(29), `${para(29)} edited`))!;
        expect(edited.slice(0, -1).map((c) => c.key)).toEqual(chunks.slice(0, -1).map((c) => c.key));
    });

    it("handles an empty body and trailing blank lines", () => {
        expect(splitMarkdownBlocks("")).toEqual([]);
        expect(texts("only\n\n\n")).toEqual(["only"]);
    });
});
