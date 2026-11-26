import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter, updateFrontmatterKey } from "./frontmatter";

describe("parseFrontmatter", () => {
    it("returns the source unchanged when there is no frontmatter", () => {
        const r = parseFrontmatter("# Just a heading");
        expect(r.hasFrontmatter).toBe(false);
        expect(r.body).toBe("# Just a heading");
        expect(r.data).toEqual({});
    });

    it("parses scalars, inline arrays, block arrays, booleans, and numbers", () => {
        const src = [
            "---",
            "title: Hello",
            "count: 3",
            "ratio: 1.5",
            "published: true",
            "tags: [a, b]",
            "list:",
            "  - x",
            "  - y",
            "---",
            "body text",
        ].join("\n");
        const r = parseFrontmatter(src);
        expect(r.hasFrontmatter).toBe(true);
        expect(r.data.title).toBe("Hello");
        expect(r.data.count).toBe(3);
        expect(r.data.ratio).toBe(1.5);
        expect(r.data.published).toBe(true);
        expect(r.data.tags).toEqual(["a", "b"]);
        expect(r.data.list).toEqual(["x", "y"]);
        expect(r.body).toBe("body text");
    });
});

describe("serializeFrontmatter round-trip", () => {
    it("re-parses to the same data", () => {
        const data = { title: "Hello", tags: ["a", "b"], count: 3, published: true };
        const serialized = serializeFrontmatter(data, "body");
        const reparsed = parseFrontmatter(serialized);
        expect(reparsed.data).toEqual(data);
    });

    it("returns the body unchanged when there is no data", () => {
        expect(serializeFrontmatter({}, "hello")).toBe("hello");
    });

    it("does not mistake horizontal-rule markdown chapters for frontmatter and supports ...", () => {
        expect(parseFrontmatter("---\nFirst paragraph.\n\nSecond paragraph.\n---\nMore text").hasFrontmatter).toBe(false);
        const dotted = parseFrontmatter("---\ntitle: Doc\n...\nBody");
        expect(dotted.hasFrontmatter).toBe(true);
        expect(dotted.data.title).toBe("Doc");
        expect(dotted.body).toBe("Body");
    });

    it("updateFrontmatterKey preserves comments, nested maps, and multiline values", () => {
        const src = [
            "---",
            "# Header comment",
            "title: Old",
            "author:",
            "  name: Alice",
            "published: false",
            "---",
            "Body",
        ].join("\n");
        const parsed = parseFrontmatter(src);
        expect(parsed.complexKeys).toContain("author");
        const next = updateFrontmatterKey(src, "published", true);
        expect(next).toContain("# Header comment");
        expect(next).toContain("author:\n  name: Alice");
        expect(next).toContain("published: true");
    });
});
