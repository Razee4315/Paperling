import { describe, it, expect } from "vitest";
import { resolveRelativePath } from "./resolveRelativePath";

describe("resolveRelativePath", () => {
  it("resolves a sibling file", () => {
    expect(resolveRelativePath("/notes/a.md", "b.md")).toBe("/notes/b.md");
  });

  it("resolves into a subfolder", () => {
    expect(resolveRelativePath("/notes/a.md", "sub/b.md")).toBe("/notes/sub/b.md");
  });

  it("walks up with ..", () => {
    expect(resolveRelativePath("/notes/deep/a.md", "../b.md")).toBe("/notes/b.md");
    expect(resolveRelativePath("/notes/deep/a.md", "../../b.md")).toBe("/b.md");
  });

  it("does not pop above the root", () => {
    expect(resolveRelativePath("/a.md", "../../../b.md")).toBe("/b.md");
  });

  it("keeps Windows backslash separators", () => {
    expect(resolveRelativePath("C:\\notes\\a.md", "sub\\b.md")).toBe("C:\\notes\\sub\\b.md");
    expect(resolveRelativePath("C:\\notes\\a.md", "b.md")).toBe("C:\\notes\\b.md");
  });

  it("drops a #fragment", () => {
    expect(resolveRelativePath("/notes/a.md", "b.md#section")).toBe("/notes/b.md");
  });

  it("decodes percent-encoded segments", () => {
    expect(resolveRelativePath("/notes/a.md", "my%20note.md")).toBe("/notes/my note.md");
  });

  it("ignores ./ and empty segments", () => {
    expect(resolveRelativePath("/notes/a.md", "./b.md")).toBe("/notes/b.md");
  });

  it("returns null for empty or NUL-bearing input", () => {
    expect(resolveRelativePath("/notes/a.md", "")).toBeNull();
    expect(resolveRelativePath("/notes/a.md", "#only-anchor")).toBeNull();
    expect(resolveRelativePath("/notes/a.md", "b\0.md")).toBeNull();
  });

  it("returns null without a base file", () => {
    expect(resolveRelativePath("", "b.md")).toBeNull();
  });
});
