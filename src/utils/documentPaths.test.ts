import { describe, expect, it } from "vitest";
import { isDocumentPath, isPathWithin, parentDirectory } from "./documentPaths";

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
