import { describe, it, expect } from "vitest";
import { computeStats, countWords, countSourceWords } from "./documentStats";

describe("computeStats", () => {
    it("returns zeros for an empty document", () => {
        const s = computeStats("");
        expect(s.words).toBe(0);
        expect(s.lines).toBe(0);
        expect(s.readingTimeMin).toBe(0);
    });

    it("counts structural elements and excludes code from word count", () => {
        const src = [
            "---",
            "a: 1",
            "---",
            "# Title",
            "",
            "Hello world.",
            "",
            "```js",
            "const ignoredCodeWords = 1;",
            "```",
            "",
            "[link](http://x) and ![img](y.png)",
        ].join("\n");
        const s = computeStats(src);
        expect(s.headings).toBe(1);
        expect(s.links).toBe(1);
        expect(s.images).toBe(1);
        expect(s.codeBlocks).toBe(1);
        // "ignoredCodeWords" lives in a fenced block and must not be counted.
        expect(s.words).toBeGreaterThan(0);
        expect(s.words).toBeLessThan(12);
    });

    it("handles tilde fences and unclosed fences", () => {
        const tilde = "before\n~~~\ncode words here\n~~~\nafter";
        expect(computeStats(tilde).words).toBe(2);
        expect(computeStats(tilde).codeBlocks).toBe(1);
        // Unclosed fence: everything after it is code, but it still counts as a block.
        const unclosed = "real prose\n```\nall of this is code\nmore code";
        expect(computeStats(unclosed).words).toBe(2);
        expect(computeStats(unclosed).codeBlocks).toBe(1);
    });

    it("does not split sentences on decimals or common abbreviations", () => {
        const s = computeStats("Version 3.14 shipped, e.g. yesterday. It works!");
        expect(s.sentences).toBe(2);
    });

    it("counts reference links, autolinks, and wikilinks", () => {
        const s = computeStats("[a](http://x) [b][ref] <https://y.com> [[Note]]");
        expect(s.links).toBe(4);
    });
});

describe("countWords", () => {
    it("ignores markdown syntax tokens", () => {
        // "#", "-", "|", "---" carry no letters/digits and must not count.
        expect(countWords("# Title")).toBe(1);
        expect(countWords("- item one\n- item two")).toBe(4);
        expect(countWords("| col | col2 |\n|-----|------|\n| a | b |")).toBe(4);
        expect(countWords("---")).toBe(0);
        expect(countWords("**bold** and *italic*")).toBe(3);
    });

    it("counts CJK characters individually", () => {
        expect(countWords("你好世界")).toBe(4);
        expect(countWords("你好 hello 世界")).toBe(5);
    });

    it("counts a link's text and URL token sensibly", () => {
        // "[link text](url)" tokenizes to 2 words — same as the visible text.
        expect(countWords("[link text](https://example.com/long/url)")).toBe(2);
    });
});

describe("countSourceWords", () => {
    it("matches computeStats words for the same source", () => {
        const src = [
            "---",
            "title: Test",
            "---",
            "# My Heading",
            "",
            "Some real prose here with seven words.",
            "",
            "- item one",
            "- item two",
            "",
            "| col | col2 |",
            "|-----|------|",
            "| a   | b    |",
            "",
            "```js",
            "const x = 1;",
            "```",
            "",
            "[link text](https://example.com) and ![img](./images/pic.png)",
        ].join("\n");
        expect(countSourceWords(src)).toBe(computeStats(src).words);
    });

    it("returns 0 for empty input", () => {
        expect(countSourceWords("")).toBe(0);
    });
});
