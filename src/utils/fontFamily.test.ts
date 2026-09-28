import { describe, expect, it } from "vitest";
import { getFontName, getFontStack, sanitizeCustomFontFamily } from "./fontFamily";

describe("sanitizeCustomFontFamily", () => {
    it("keeps ordinary system font names", () => {
        expect(sanitizeCustomFontFamily("Atkinson Hyperlegible")).toBe("Atkinson Hyperlegible");
        expect(sanitizeCustomFontFamily("Noto Sans CJK JP")).toBe("Noto Sans CJK JP");
    });

    it("removes characters that can escape a CSS font-family value", () => {
        expect(sanitizeCustomFontFamily('Safe"; color: red; /*')).toBe("Safe color red ");
    });
});

describe("getFontStack", () => {
    it("quotes a custom family and keeps Inter as the final fallback", () => {
        expect(getFontStack("custom", "IBM Plex Sans")).toBe('"IBM Plex Sans", \'Inter\'');
    });

    it("falls back to Inter when the custom family is empty", () => {
        expect(getFontStack("custom", "  ")).toBe("'Inter'");
    });

    it("keeps the bundled font stacks unchanged", () => {
        expect(getFontStack("lora")).toBe("'Lora', Georgia, 'Times New Roman', serif");
    });
});

describe("getFontName", () => {
    it("returns a safe single family for document exports", () => {
        expect(getFontName("custom", "IBM Plex Sans")).toBe("IBM Plex Sans");
        expect(getFontName("custom", "")).toBe("Inter");
        expect(getFontName("source-serif")).toBe("Source Serif 4");
    });
});
