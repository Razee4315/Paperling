import type { FontFamily } from "../context/ThemeContext";

export const CUSTOM_FONT_MAX_LENGTH = 100;

const FONT_STACKS: Record<Exclude<FontFamily, "custom">, string> = {
    inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    merriweather: "'Merriweather', Georgia, 'Times New Roman', serif",
    lora: "'Lora', Georgia, 'Times New Roman', serif",
    "source-serif": "'Source Serif 4', Georgia, 'Times New Roman', serif",
    "fira-sans": "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const FONT_NAMES: Record<Exclude<FontFamily, "custom">, string> = {
    inter: "Inter",
    merriweather: "Merriweather",
    lora: "Lora",
    "source-serif": "Source Serif 4",
    "fira-sans": "Fira Sans",
};

/**
 * Keep a custom family name safe to place in CSS. Custom fonts are deliberately
 * a single local family, not an arbitrary font-family declaration, so CSS
 * delimiters and escapes are removed before the value is stored or rendered.
 */
export function sanitizeCustomFontFamily(value: string): string {
    return value
        .replace(/[\u0000-\u001f\u007f"\\,;:{}()[\]/*]/g, "")
        .replace(/\s+/g, " ")
        .slice(0, CUSTOM_FONT_MAX_LENGTH);
}

export function getFontStack(font: FontFamily, customFont = ""): string {
    if (font !== "custom") return FONT_STACKS[font];

    const family = sanitizeCustomFontFamily(customFont).trim();
    return family ? `${JSON.stringify(family)}, 'Inter'` : "'Inter'";
}

export function getFontName(font: FontFamily, customFont = ""): string {
    if (font !== "custom") return FONT_NAMES[font];
    return sanitizeCustomFontFamily(customFont).trim() || "Inter";
}
