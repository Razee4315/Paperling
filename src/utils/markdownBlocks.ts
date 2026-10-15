/**
 * Split a markdown body into independently renderable top-level blocks, so
 * the preview can re-render ONLY the blocks an edit touched. PERF-02.
 *
 * Before this, every debounced keystroke re-ran remark + rehype + highlight +
 * react-markdown over the WHOLE document. On a 190 kB note that was a ~2.5 s
 * main-thread freeze per pause in a dev build — even in code mode, where the
 * preview isn't visible — and split view stuttered on anything long.
 *
 * A boundary is only placed where CommonMark itself would end every open
 * construct: a blank line, outside fenced code / $$ math / HTML comments /
 * raw-HTML containers, followed by a line that starts at column 0 and is not
 * a list item or a definition (those can continue across blank lines). When
 * in doubt, blocks are simply merged — a larger block is always correct,
 * just less incremental.
 *
 * Two document-wide constructs need care:
 *  - Footnotes number and collect across the whole document, so a body with
 *    footnote definitions is not split at all (returns null).
 *  - Link reference definitions (`[id]: https://…`) may be used in any
 *    block, so they are appended to every block that could reference one.
 *    They render nothing, and sit after the block's text so line numbers
 *    inside the block are unaffected.
 */

export interface MarkdownBlock {
    /** Stable React key: text hash + occurrence, so unchanged blocks keep
     *  their identity (and skip re-rendering) when blocks above them change. */
    key: string;
    /** Markdown to render (may carry appended reference definitions). */
    text: string;
    /** Body lines before this block: rendered line N is body line N + offset. */
    lineOffset: number;
}

const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]\n]+\]:/m;
const REFERENCE_DEF = /^ {0,3}\[(?!\^)[^\]\n]+\]:\s*\S/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])(\s|$)/;
// Raw-HTML containers whose content may legitimately span blank lines
// (<details> with markdown inside is the common GitHub pattern).
const HTML_CONTAINERS = "details|div|section|article|aside|figure|center|table|blockquote|ul|ol|dl|nav|header|footer|main|pre|script|style|textarea";
const HTML_OPEN = new RegExp(`<(${HTML_CONTAINERS})(?=[\\s>])[^>]*?(/?)>`, "gi");
const HTML_CLOSE = new RegExp(`</(${HTML_CONTAINERS})\\s*>`, "gi");

/** 32-bit FNV-1a; only used for React keys, so collisions merely cost a re-render. */
function hash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** Net change in raw-HTML container depth on one line (inline code ignored). */
function htmlDepthDelta(line: string): number {
    if (!line.includes("<")) return 0;
    const bare = line.replace(/`+[^`]*`+/g, "");
    let delta = 0;
    for (const m of bare.matchAll(HTML_OPEN)) if (m[2] !== "/") delta++;
    for (const _ of bare.matchAll(HTML_CLOSE)) delta--;
    return delta;
}

/** Soft size cap for one render chunk. */
const CHUNK_CHARS = 3000;
const HEADING_LINE = /^#{1,6}\s/;

/**
 * Merge consecutive blocks into section-sized render chunks. Each chunk is
 * one react-markdown instance, and an instance has a fixed setup cost (a
 * fresh unified processor with every plugin), so thousands of one-paragraph
 * chunks made the FIRST render of a long note slower than rendering it
 * whole. Boundaries are content-defined (a new chunk starts at every heading,
 * or once a chunk passes CHUNK_CHARS), so typing only ever changes the chunk
 * it happens in — a greedy fixed-size grouping would shift every boundary
 * after the edit and re-render the rest of the document. Merging adjacent
 * blocks is always safe: it is just a less-split document.
 */
function groupRanges(ranges: { start: number; end: number }[], lines: string[], chunkChars: number): { start: number; end: number }[] {
    if (chunkChars <= 0) return ranges;
    const groups: { start: number; end: number; chars: number }[] = [];
    for (const r of ranges) {
        let chars = 0;
        for (let i = r.start; i < r.end; i++) chars += lines[i].length + 1;
        const last = groups[groups.length - 1];
        if (last && !HEADING_LINE.test(lines[r.start]) && last.chars < chunkChars) {
            last.end = r.end;
            last.chars += chars;
        } else {
            groups.push({ start: r.start, end: r.end, chars });
        }
    }
    return groups;
}

/** `chunkChars` 0 returns every top-level block on its own (tests). */
export function splitMarkdownBlocks(body: string, chunkChars: number = CHUNK_CHARS): MarkdownBlock[] | null {
    if (FOOTNOTE_DEF.test(body)) return null;
    const lines = body.split("\n");

    const ranges: { start: number; end: number }[] = [];
    const refDefs: string[] = [];
    let fence: { char: string; len: number } | null = null;
    let inMath = false;
    let inComment = false;
    let htmlDepth = 0;
    let start = -1; // first line of the current block, -1 = between blocks

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const blank = line.trim() === "";

        if (start === -1) {
            if (blank) continue;
            start = i;
        }

        // --- constructs that can span blank lines ---
        if (fence) {
            const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
            if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
            continue;
        }
        if (inMath) {
            if (line.includes("$$")) inMath = false;
            continue;
        }
        if (inComment) {
            if (line.includes("-->")) inComment = false;
            continue;
        }
        const open = line.match(FENCE_OPEN);
        if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
            fence = { char: open[1][0], len: open[1].length };
            continue;
        }
        const trimmed = line.trim();
        if (trimmed.startsWith("$$") && !(trimmed.length > 2 && trimmed.endsWith("$$") && trimmed.length >= 4)) {
            inMath = true;
            continue;
        }
        if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) {
            inComment = true;
            continue;
        }
        htmlDepth = Math.max(0, htmlDepth + htmlDepthDelta(line));
        if (REFERENCE_DEF.test(line)) refDefs.push(line);

        // --- block boundary ---
        if (!blank || htmlDepth > 0) continue;
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j >= lines.length) break;
        const next = lines[j];
        if (/^\s/.test(next) || LIST_ITEM.test(next) || next.startsWith(":")) continue;
        ranges.push({ start, end: i });
        start = -1;
        i = j - 1; // resume at the next block's first line
    }
    if (start !== -1) ranges.push({ start, end: lines.length });

    const defs = refDefs.length ? `\n\n${refDefs.join("\n")}` : "";
    const seen = new Map<string, number>();
    return groupRanges(ranges, lines, chunkChars).map(({ start: s, end }) => {
        let e = end;
        while (e > s && lines[e - 1].trim() === "") e--;
        const own = lines.slice(s, e).join("\n");
        const text = defs && own.includes("[") ? own + defs : own;
        const h = hash(text);
        const n = seen.get(h) ?? 0;
        seen.set(h, n + 1);
        return { key: `${h}:${n}`, text, lineOffset: s };
    });
}
