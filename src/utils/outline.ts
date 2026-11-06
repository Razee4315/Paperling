/**
 * Headings for the outline panel, read from the markdown source. TOC-03.
 *
 * The outline used to show the raw source of each heading ("**Setup** for
 * [Windows](https://…) {#win} ##"), missed setext headings (`Title` over a
 * `===` line) and accepted `#` lines indented like code. Lines are 1-based
 * and content-relative, the same numbering the editor and preview use.
 */

import { stripInlineMarkdown } from "./saveName";

export interface OutlineHeading {
    text: string;
    level: number;
    line: number;
    /** The `{#custom-id}` written on the heading, when there is one. */
    customId?: string;
}

/** Slugify heading text into a stable, URL-safe id (GitHub-style). Unicode
 *  letters/digits (CJK, Cyrillic, accented Latin) are kept so those headings
 *  get distinct anchors and in-document links can resolve — the old ASCII-only
 *  class collapsed every CJK heading to `section`, `section-1`, … (NAV-06). */
export const slugify = (text: string): string =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CUSTOM_ID = /\s*\{#([\w-]+)\}\s*$/;

/** Can this line be (part of) a setext heading's paragraph? */
const isParagraphLine = (line: string) =>
    line.trim() !== "" &&
    !/^ {4,}/.test(line) &&
    !ATX.test(line) &&
    !/^\s*([-*+]|\d+[.)])(\s|$)/.test(line) &&
    !/^\s*>/.test(line) &&
    !FENCE.test(line) &&
    !/^\s*\|/.test(line) &&
    !SETEXT_UNDERLINE.test(line);

const clean = (raw: string) => stripInlineMarkdown(raw.replace(CUSTOM_ID, "")).trim();

export function extractHeadings(content: string): OutlineHeading[] {
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    const out: OutlineHeading[] = [];
    let i = 0;
    if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
        if (end > 0) i = end + 1;
    }
    let fence: { char: string; len: number } | null = null;
    let paraStart = -1; // first line of the paragraph above, for setext
    for (; i < lines.length; i++) {
        const line = lines[i];
        if (fence) {
            const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
            if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
            continue;
        }
        const open = line.match(FENCE);
        if (open) {
            fence = { char: open[1][0], len: open[1].length };
            paraStart = -1;
            continue;
        }
        const atx = line.match(ATX);
        if (atx) {
            const text = clean(atx[2] ?? "");
            const customId = atx[2]?.match(CUSTOM_ID)?.[1];
            if (text) out.push({ text, level: atx[1].length, line: i + 1, ...(customId ? { customId } : {}) });
            paraStart = -1;
            continue;
        }
        const underline = line.match(SETEXT_UNDERLINE);
        if (underline && paraStart !== -1) {
            const text = clean(lines.slice(paraStart, i).map((l) => l.trim()).join(" "));
            if (text) out.push({ text, level: underline[1][0] === "=" ? 1 : 2, line: paraStart + 1 });
            paraStart = -1;
            continue;
        }
        if (isParagraphLine(line)) {
            if (paraStart === -1) paraStart = i;
        } else {
            paraStart = -1;
        }
    }
    return out;
}
