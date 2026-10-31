/**
 * A table of contents inside the document. TOC-05.
 *
 * Two forms, because both are in everyday use:
 *
 * - The "Insert table of contents" command writes a real linked list between
 *   `<!-- toc -->` markers (the markdown-toc / VS Code convention). It renders
 *   on GitHub and everywhere else, and running the command again refreshes it.
 * - A `[TOC]` line (Typora and many static-site tools) renders as the same list
 *   in the preview only; the source keeps the marker.
 *
 * Anchors follow the preview's ids: the GitHub slug, `{#custom}` when there is
 * one, and -1, -2… on repeats (dedupeHeadingIds).
 */

import { extractHeadings, slugify } from "./outline";

export const TOC_START = "<!-- toc -->";
export const TOC_END = "<!-- tocstop -->";

const MARKER_LINE = /^\s*\[toc\]\s*$/i;

/** Is this paragraph exactly a `[TOC]` marker? */
export const isTocMarker = (text: string): boolean => MARKER_LINE.test(text);

const escapeLabel = (text: string) => text.replace(/([[\]\\])/g, "\\$1");

/** The linked list for `content`, or "" without headings. A lone H1 is the
 *  document's title, not a section of it, so it stays out of the list. */
export function tocMarkdown(content: string): string {
    const headings = extractHeadings(content);
    const seen = new Map<string, number>();
    const entries = headings.map((heading) => {
        const base = heading.customId ?? (slugify(heading.text) || "section");
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return { ...heading, id: count === 0 ? base : `${base}-${count}` };
    });
    const isLoneTitle = entries.length > 1 && entries[0].level === 1 && entries.filter((e) => e.level === 1).length === 1;
    const listed = isLoneTitle ? entries.slice(1) : entries;
    if (listed.length === 0) return "";
    const top = Math.min(...listed.map((e) => e.level));
    return listed.map((e) => `${"  ".repeat(e.level - top)}- [${escapeLabel(e.text)}](#${e.id})`).join("\n");
}

export interface TocEdit {
    from: number;
    to: number;
    insert: string;
}

/** The edit that refreshes the marked table of contents, or inserts one at
 *  `caret`. Null when the document has no headings to list. */
export function upsertToc(content: string, caret: number): TocEdit | null {
    const start = content.indexOf(TOC_START);
    const end = start === -1 ? -1 : content.indexOf(TOC_END, start);
    // Refreshing must not count the old list, but it has no headings anyway.
    const list = tocMarkdown(content);
    if (!list) return null;
    const insert = `${TOC_START}\n\n${list}\n\n${TOC_END}`;
    if (start !== -1 && end !== -1) return { from: start, to: end + TOC_END.length, insert };
    return { from: caret, to: caret, insert };
}
