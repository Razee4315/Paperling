import { describe, expect, it } from "vitest";
import { withNoteExtension } from "../components/FileExplorer";
import { normalizeMarkdownFileName } from "./mobileFiles";

describe("note names keep the extension the app opens (#295)", () => {
    it("adds .md only when there is no document extension", () => {
        expect(withNoteExtension("draft")).toBe("draft.md");
        expect(withNoteExtension("  draft  ")).toBe("draft.md");
        expect(withNoteExtension("my.notes")).toBe("my.notes.md");
    });
    it("leaves every opened type alone", () => {
        for (const name of ["a.md", "a.mdx", "a.mdown", "a.txt", "page.html", "PAGE.HTM"]) {
            expect(withNoteExtension(name)).toBe(name);
        }
    });
    it("keeps an HTML page's extension in the mobile save flow", () => {
        expect(normalizeMarkdownFileName("page.html")).toBe("page.html");
        expect(normalizeMarkdownFileName("page.htm")).toBe("page.htm");
        expect(normalizeMarkdownFileName("page")).toBe("page.md");
    });
});
