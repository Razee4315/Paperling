import { describe, expect, it } from "vitest";
import { standaloneSvg } from "./diagramExport";

describe("standaloneSvg", () => {
    it("adds explicit pixel dimensions, background rect, and substituted font family", () => {
        document.documentElement.style.setProperty("--font-body", '"Inter", sans-serif');
        const svg = `<svg viewBox="4 8 320 180" style="max-width:320px"><style>text{font-family:var(--font-body);}</style><g><rect width="10" height="10"/></g></svg>`;
        const { markup, width, height } = standaloneSvg(svg, '#fff" onclick="evil()');

        expect(width).toBe(320);
        expect(height).toBe(180);

        const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
        const root = doc.documentElement;
        expect(root.getAttribute("width")).toBe("320");
        expect(root.getAttribute("height")).toBe("180");
        expect(root.getAttribute("style")).toBeNull();
        expect(root.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");

        const firstRect = root.firstElementChild;
        expect(firstRect?.tagName.toLowerCase()).toBe("rect");
        expect(firstRect?.getAttribute("x")).toBe("4");
        expect(firstRect?.getAttribute("y")).toBe("8");
        expect(firstRect?.getAttribute("fill")).toBe('#fff" onclick="evil()');
        expect(root.getAttribute("onclick")).toBeNull();
        expect(markup).not.toContain("var(--font-body)");
        document.documentElement.style.removeProperty("--font-body");
    });
});
