import { describe, it, expect } from "vitest";
import { extractHeadings } from "./outline";

describe("extractHeadings (TOC-03)", () => {
    it("reads ATX headings with clean text and source lines", () => {
        const md = "# Title\n\n## **Setup** for [Windows](https://x.com) {#win} ##\n\n### snake_case_name";
        expect(extractHeadings(md)).toEqual([
            { text: "Title", level: 1, line: 1 },
            { text: "Setup for Windows", level: 2, line: 3 },
            { text: "snake_case_name", level: 3, line: 5 },
        ]);
    });

    it("reads setext headings, including multi-line ones", () => {
        const md = "Big Title\n=========\n\nSection\nspans two\n---\n\ntext";
        expect(extractHeadings(md)).toEqual([
            { text: "Big Title", level: 1, line: 1 },
            { text: "Section spans two", level: 2, line: 4 },
        ]);
    });

    it("does not treat thematic breaks, list items or code as headings", () => {
        const md = "para\n\n---\n\n- item\n---\n\n    # indented code\n\n```bash\n# comment\n```\n\n~~~\n# also code\n~~~";
        expect(extractHeadings(md)).toEqual([]);
    });

    it("skips frontmatter and keeps content-relative line numbers", () => {
        const md = "---\ntitle: x\n# not a heading\n---\n# Real";
        expect(extractHeadings(md)).toEqual([{ text: "Real", level: 1, line: 5 }]);
    });

    it("ignores empty ATX headings", () => {
        expect(extractHeadings("#\n\n## \n\n## ok")).toEqual([{ text: "ok", level: 2, line: 5 }]);
    });
});
