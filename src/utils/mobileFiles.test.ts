import { describe, it, expect } from "vitest";
import { normalizeMarkdownFileName, joinNotesPath } from "./mobileFiles";

describe("normalizeMarkdownFileName", () => {
    it("passes clean names through and guarantees .md", () => {
        expect(normalizeMarkdownFileName("My Note")).toBe("My Note.md");
        expect(normalizeMarkdownFileName("My Note.md")).toBe("My Note.md");
        expect(normalizeMarkdownFileName("note.markdown")).toBe("note.markdown.md"); // .md is the contract
        expect(normalizeMarkdownFileName("UPPER.MD")).toBe("UPPER.MD");
    });

    it("strips filesystem-illegal characters", () => {
        expect(normalizeMarkdownFileName('a/b:c*d?"e<f>g|h')).toBe("a-b-c-d-e-f-g-h.md");
        expect(normalizeMarkdownFileName("back\\slash")).toBe("back-slash.md");
        expect(normalizeMarkdownFileName("null\u0000byte")).toBe("null-byte.md");
    });

    it("trims whitespace and leading dots", () => {
        expect(normalizeMarkdownFileName("  spaced  ")).toBe("spaced.md");
        expect(normalizeMarkdownFileName("..hidden")).toBe("hidden.md");
    });

    it("falls back to Untitled.md for unusable input", () => {
        expect(normalizeMarkdownFileName("")).toBe("Untitled.md");
        expect(normalizeMarkdownFileName("   ")).toBe("Untitled.md");
        expect(normalizeMarkdownFileName("..")).toBe("Untitled.md");
        expect(normalizeMarkdownFileName("*/:?")).toBe("Untitled.md");
    });

    it("keeps interior dots as part of the name", () => {
        expect(normalizeMarkdownFileName("2026.09.notes")).toBe("2026.09.notes.md");
    });
});

describe("joinNotesPath", () => {
    it("joins the notes dir with a normalized name", () => {
        expect(joinNotesPath("/data/data/app/files/notes", "Hello")).toBe("/data/data/app/files/notes/Hello.md");
    });

    it("tolerates a trailing separator on the dir", () => {
        expect(joinNotesPath("/notes/", "Hello")).toBe("/notes/Hello.md");
    });

    it("returns null without a directory (caller should keep the dialog closed)", () => {
        expect(joinNotesPath("", "Hello")).toBeNull();
        expect(joinNotesPath("   ", "Hello")).toBeNull();
    });

    it("never lets the name escape the directory", () => {
        const path = joinNotesPath("/notes", "../evil");
        // The traversal attempt is neutralized into an innocuous name inside
        // the notes dir (".." is stripped with any other leading dots).
        expect(path).toBe("/notes/evil.md");
        expect(path!.startsWith("/notes/")).toBe(true);
    });
});
