import { describe, expect, it } from "vitest";
import { isDocumentPath, isPathWithin } from "./documentPaths";

describe("workspace paths (#227)", () => {
    it("accepts every supported note suffix, including uppercase and text", () => {
        for (const path of ["C:/notes/NOTE.MD", "/a.markdown", "/a.txt", "/a.TEXT"]) expect(isDocumentPath(path)).toBe(true);
        for (const path of ["/a.md.exe", "/folder", "/image.png"]) expect(isDocumentPath(path)).toBe(false);
    });
    it("keeps root navigation inside a complete path segment", () => {
        expect(isPathWithin("C:/NOTES/sub", "c:\\notes\\")).toBe(true);
        expect(isPathWithin("/notes-other", "/notes")).toBe(false);
        expect(isPathWithin("/Notes/sub", "/notes")).toBe(false);
        expect(isPathWithin("/notes", "/notes")).toBe(true);
        expect(isPathWithin("/notes", "/")).toBe(true);
    });
});
