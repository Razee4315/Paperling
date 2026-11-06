import { describe, expect, it } from "vitest";
import { isDocumentPath, isHtmlPath, isPathWithin, isUnsafeRelativePath, parentDirectory } from "./documentPaths";

describe("workspace paths (#227)", () => {
    it("walks back to Unix and Windows drive roots without becoming drive-relative", () => {
        expect(parentDirectory("/home")).toBe("/");
        expect(parentDirectory("C:\\child")).toBe("C:/");
        expect(parentDirectory("c:/child/")).toBe("c:/");
        expect(isPathWithin(parentDirectory("c:/child")!, "C:/")).toBe(true);
        for (const root of ["/", "C:/", "C:\\", null]) expect(parentDirectory(root)).toBeNull();
        expect(parentDirectory("/notes/sub/file.md")).toBe("/notes/sub");
    });
    it("accepts every supported note suffix, including uppercase and text", () => {
        for (const path of ["C:/notes/NOTE.MD", "/a.markdown", "/a.txt", "/a.TEXT", "/a.mdx", "/a.Mdown", "/a.mkd"]) expect(isDocumentPath(path)).toBe(true);
        for (const path of ["/a.md.exe", "/folder", "/image.png"]) expect(isDocumentPath(path)).toBe(false);
    });
    it("opens HTML pages and tells them from notes (#295)", () => {
        for (const path of ["/a.html", "C:/site/INDEX.HTM"]) {
            expect(isDocumentPath(path)).toBe(true);
            expect(isHtmlPath(path)).toBe(true);
        }
        for (const path of ["/a.md", "/a.html.bak", null, undefined, ""]) expect(isHtmlPath(path)).toBe(false);
    });
    it("rejects paths that leave the document's folder", () => {
        for (const path of ["", "../a.png", "a/../../b", "/etc/passwd", "\\\\share\\x", "C:/x.png", "a\0b"]) expect(isUnsafeRelativePath(path)).toBe(true);
        for (const path of ["a.png", "img/a.png", "a..b/c.png"]) expect(isUnsafeRelativePath(path)).toBe(false);
    });
    it("keeps root navigation inside a complete path segment", () => {
        expect(isPathWithin("C:/NOTES/sub", "c:\\notes\\")).toBe(true);
        expect(isPathWithin("/notes-other", "/notes")).toBe(false);
        expect(isPathWithin("/Notes/sub", "/notes")).toBe(false);
        expect(isPathWithin("/notes", "/notes")).toBe(true);
        expect(isPathWithin("/notes", "/")).toBe(true);
    });
});
