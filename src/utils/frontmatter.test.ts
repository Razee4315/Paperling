import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

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
});
