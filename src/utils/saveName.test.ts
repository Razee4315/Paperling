import { describe, it, expect } from "vitest";
import { suggestFileName, dirOf, joinPath } from "./saveName";

describe("suggestFileName (SAVE-05)", () => {
    it("uses the first heading", () => {
        expect(suggestFileName("# Meeting notes\n\ntext", "Untitled-1.md")).toBe("Meeting notes.md");
        expect(suggestFileName("\n\n## **Big** [idea](https://x.com)\n", "Untitled-1.md")).toBe("Big idea.md");
    });

    it("prefers a frontmatter title and skips the frontmatter block otherwise", () => {
        expect(suggestFileName("---\ntitle: \"Trip plan\"\ntags: [x]\n---\n# Other", "U.md")).toBe("Trip plan.md");
        expect(suggestFileName("---\ntags: [x]\n---\n# Real title", "U.md")).toBe("Real title.md");
    });

    it("falls back to the first line of text, trimmed at a word boundary", () => {
        expect(suggestFileName("- [ ] buy milk and eggs", "U.md")).toBe("buy milk and eggs.md");
        const long = "word ".repeat(30);
        const name = suggestFileName(long, "U.md");
        expect(name.length).toBeLessThanOrEqual(63);
        expect(name.endsWith("word.md")).toBe(true);
    });

    it("ignores headings inside code fences", () => {
        expect(suggestFileName("```\n# not a title\n```\n# Title", "U.md")).toBe("Title.md");
    });

    it("strips characters file systems reject, and reserved names", () => {
        expect(suggestFileName("# a/b: c?*d|e", "U.md")).toBe("a b c d e.md");
        expect(suggestFileName("# CON", "U.md")).toBe("U.md");
        expect(suggestFileName("# ...hidden.", "U.md")).toBe("hidden.md");
    });

    it("returns the fallback for an empty note", () => {
        expect(suggestFileName("", "Untitled-2.md")).toBe("Untitled-2.md");
        expect(suggestFileName("\n\n   \n", "Untitled-2.md")).toBe("Untitled-2.md");
    });
});

describe("dirOf / joinPath", () => {
    it("handles both separators", () => {
        expect(dirOf("C:\\Notes\\a.md")).toBe("C:\\Notes");
        expect(dirOf("/home/u/a.md")).toBe("/home/u");
        expect(dirOf("a.md")).toBeNull();
        expect(joinPath("C:\\Notes", "b.md")).toBe("C:\\Notes\\b.md");
        expect(joinPath("/home/u/", "b.md")).toBe("/home/u/b.md");
    });
});
