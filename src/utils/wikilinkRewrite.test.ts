import { describe, it, expect } from "vitest";
import { rewriteWikilinksOutsideCode } from "../components/MarkdownPreview";

describe("rewriteWikilinksOutsideCode (NAV-08)", () => {
    it("rewrites wikilinks in plain prose", () => {
        expect(rewriteWikilinksOutsideCode("see [[Foo Bar]] now")).toBe(
            "see [Foo Bar](wikilink:Foo%20Bar) now",
        );
    });

    it("supports aliases", () => {
        expect(rewriteWikilinksOutsideCode("[[Foo|the bar]]")).toBe(
            "[the bar](wikilink:Foo)",
        );
    });

    it("leaves [[...]] inside fenced code blocks untouched", () => {
        const doc = "prose [[A]]\n\n```js\nconst x = [[1, 2]].flat();\n```\n\n[[B]]";
        expect(rewriteWikilinksOutsideCode(doc)).toBe(
            "prose [A](wikilink:A)\n\n```js\nconst x = [[1, 2]].flat();\n```\n\n[B](wikilink:B)",
        );
    });

    it("leaves [[...]] inside tilde fences untouched", () => {
        const doc = "~~~\n[[keep]]\n~~~\n[[rewrite]]";
        expect(rewriteWikilinksOutsideCode(doc)).toBe(
            "~~~\n[[keep]]\n~~~\n[rewrite](wikilink:rewrite)",
        );
    });

    it("leaves [[...]] inside inline code spans untouched", () => {
        expect(rewriteWikilinksOutsideCode("use `[[x]]` here [[Real]]")).toBe(
            "use `[[x]]` here [Real](wikilink:Real)",
        );
    });

    it("leaves [[...]] inside inline math untouched", () => {
        expect(rewriteWikilinksOutsideCode("$f[[i]]$ and [[Real]]")).toBe(
            "$f[[i]]$ and [Real](wikilink:Real)",
        );
    });

    it("leaves [[...]] inside block math untouched", () => {
        const doc = "$$\nm[[i]] = 0\n$$\n[[Real]]";
        expect(rewriteWikilinksOutsideCode(doc)).toBe(
            "$$\nm[[i]] = 0\n$$\n[Real](wikilink:Real)",
        );
    });

    it("toggles fences off correctly (content after close is rewritten)", () => {
        const doc = "```\n[[a]]\n```\ntext [[b]]\n```\n[[c]]\n```";
        expect(rewriteWikilinksOutsideCode(doc)).toBe(
            "```\n[[a]]\n```\ntext [b](wikilink:b)\n```\n[[c]]\n```",
        );
    });

    it("parses Obsidian image embed dimensions only on ![[...]] embeds", () => {
        expect(rewriteWikilinksOutsideCode("![[photo.png|300]]")).toBe(
            "![photo.png](wikilink:photo.png#w=300)",
        );
        expect(rewriteWikilinksOutsideCode("![[photo.png|300x200]]")).toBe(
            "![photo.png](wikilink:photo.png#w=300&h=200)",
        );
        expect(rewriteWikilinksOutsideCode("![[photo.png|My caption|400x250]]")).toBe(
            "![My caption](wikilink:photo.png#w=400&h=250)",
        );
        expect(rewriteWikilinksOutsideCode("![[photo.png|99999]]")).toBe(
            "![99999](wikilink:photo.png)",
        );
        expect(rewriteWikilinksOutsideCode("[[Note|300]]")).toBe(
            "[300](wikilink:Note)",
        );
    });
});
