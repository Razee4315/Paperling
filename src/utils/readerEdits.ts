import TurndownService from "turndown";

const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
converter.addRule("strike", { filter: ["del", "s"], replacement: (text) => `~~${text}~~` });

export interface ReaderEditRange { start: number; end: number; source: string }

/** READ-02 (#213): edit one source-addressed text block. Extended syntax and
 * embedded media remain read-only rather than being flattened by HTML export.
 * Every byte outside the chosen block, including frontmatter, stays intact. */
export function readerEditRange(document: string, startLine: number, endLine: number, tag: string): ReaderEditRange | null {
    if (!/^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(tag) || !Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return null;
    const lines = document.split("\n");
    if (endLine > lines.length) return null;
    const start = lines.slice(0, startLine - 1).reduce((length, line) => length + line.length + 1, 0);
    let end = start + lines.slice(startLine - 1, endLine).join("\n").length;
    if (document[end - 1] === "\r") end--;
    const source = document.slice(start, end);
    // These constructs require a richer Markdown model; keep them available in
    // Code. The reader must never silently erase comments, refs, math or ids.
    if (/%%|<|\[\[|!\[|\[\^|\]\s*\[|\{#|==|`{3,}|~{3,}|(?:^|\s)#[\p{L}\p{N}_-]+|\$|\^|(?<!~)~(?!~)|^\s*[-*+]\s+\[[ xX]\]|^\s*>\s*\[!|^\s*\[[^\]]+\]:|^[ \t>]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\||$)/mu.test(source)) return null;
    return { start, end, source };
}

export function readerHtmlToMarkdown(html: string, crlf: boolean): string {
    const markdown = converter.turndown(html);
    return crlf ? markdown.replace(/\n/g, "\r\n") : markdown;
}

/** Reject stale offsets instead of overwriting another tab or external edit. */
export function applyReaderEdit(document: string, range: ReaderEditRange, replacement: string): string | null {
    if (document.slice(range.start, range.end) !== range.source) return null;
    return document.slice(0, range.start) + replacement + document.slice(range.end);
}
