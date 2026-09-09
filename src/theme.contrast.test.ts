import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Selected text in the editor is NOT recolored: CodeMirror's drawSelection
// paints --selection-bg as a layer BEHIND the content, so the text keeps its
// syntax color and --selection-text never applies there. That made the light and
// paper themes unreadable when selected (#146) — a near-black selection block
// under near-black text. The invariant below is what guarantees it can't
// regress: every theme's selection background must contrast with the theme's
// own text color, not just with the text color it *wishes* selected text had.

const css = readFileSync(resolve(__dirname, "index.css"), "utf-8");

/** Pull one theme's custom properties out of index.css by its selector. */
function themeVars(selector: string): Record<string, string> {
    // Blocks are flat (no nesting), so up to the first closing brace is the block.
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`theme block not found: ${selector}`);
    const block = css.slice(start, css.indexOf("}", start));
    const vars: Record<string, string> = {};
    for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        vars[name] = value.trim();
    }
    return vars;
}

function luminance(hex: string): number {
    const h = hex.replace("#", "");
    const channel = (i: number) => {
        const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
    ['[data-theme="dark"]', "dark"],
    ['[data-theme="light"]', "light"],
    ['[data-theme="paper"]', "paper"],
    ['[data-theme="dracula"]', "dracula"],
    ['[data-theme="graphite"]', "graphite"],
    ['[data-theme="nord"]', "nord"],
    ['[data-theme="midnight"]', "midnight"],
] as const;

describe("theme selection contrast", () => {
    it.each(THEMES)("%s keeps unrecolored text readable on the selection", (selector) => {
        const vars = themeVars(selector);
        expect(vars["--selection-bg"]).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(vars["--selection-bg"], vars["--text-primary"])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(THEMES)("%s keeps the selection distinguishable from the editor background", (selector) => {
        const vars = themeVars(selector);
        // The other half of #146: a selection that vanishes into the page. 1.45
        // is where the four themes currently sit (dark, the strongest, is 1.9);
        // anything much below reads as "did my selection take?".
        expect(contrast(vars["--selection-bg"], vars["--bg-editor"])).toBeGreaterThanOrEqual(1.45);
    });

    it.each(THEMES)("%s recolors natively-selected text readably too", (selector) => {
        const vars = themeVars(selector);
        // The global ::selection rule (preview, inputs) DOES apply
        // --selection-text, so that pairing has to hold as well.
        expect(contrast(vars["--selection-bg"], vars["--selection-text"])).toBeGreaterThanOrEqual(4.5);
    });
});
