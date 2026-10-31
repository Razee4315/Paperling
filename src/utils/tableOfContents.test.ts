import { describe, expect, it } from "vitest";
import { isTocMarker, tocMarkdown, TOC_END, TOC_START, upsertToc } from "./tableOfContents";

describe("tocMarkdown (TOC-05)", () => {
    it("nests by level and leaves out a lone title", () => {
        expect(tocMarkdown("# Title\n\n## One\n\n### Deep\n\n## Two\n")).toBe("- [One](#one)\n  - [Deep](#deep)\n- [Two](#two)");
    });

    it("keeps several H1s, since none of them is the title", () => {
        expect(tocMarkdown("# A\n\n# B\n")).toBe("- [A](#a)\n- [B](#b)");
    });

    it("keeps a document's only heading", () => {
        expect(tocMarkdown("# Only\n\ntext")).toBe("- [Only](#only)");
    });

    it("numbers repeated headings the way the preview does", () => {
        expect(tocMarkdown("## Setup\n\n## Setup\n\n## Setup\n")).toBe("- [Setup](#setup)\n- [Setup](#setup-1)\n- [Setup](#setup-2)");
    });

    it("uses a custom id and escapes brackets in labels", () => {
        expect(tocMarkdown("## Install {#get-started}\n\n## Use [beta]\n")).toBe("- [Install](#get-started)\n- [Use \\[beta\\]](#use-beta)");
    });

    it("ignores # lines in code", () => {
        expect(tocMarkdown("## Real\n\n```\n## Fake\n```\n")).toBe("- [Real](#real)");
    });

    it("is empty without headings", () => {
        expect(tocMarkdown("just text")).toBe("");
    });
});

describe("[TOC] markers", () => {
    it("recognises the marker in any case", () => {
        expect(isTocMarker("[TOC]")).toBe(true);
        expect(isTocMarker("  [toc]  ")).toBe(true);
        expect(isTocMarker("see [TOC] here")).toBe(false);
    });
});

describe("upsertToc", () => {
    it("inserts at the caret between markers", () => {
        const doc = "# T\n\n\n\n## A\n";
        const edit = upsertToc(doc, 5)!;
        expect(edit).toMatchObject({ from: 5, to: 5 });
        expect(edit.insert).toBe(`${TOC_START}\n\n- [A](#a)\n\n${TOC_END}`);
    });

    it("refreshes an existing list in place, wherever the caret is", () => {
        const doc = `# T\n\n${TOC_START}\n\n- [Old](#old)\n\n${TOC_END}\n\n## New\n`;
        const edit = upsertToc(doc, doc.length)!;
        const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
        expect(next).toBe(`# T\n\n${TOC_START}\n\n- [New](#new)\n\n${TOC_END}\n\n## New\n`);
    });

    it("does nothing without headings", () => {
        expect(upsertToc("text", 0)).toBeNull();
    });
});
