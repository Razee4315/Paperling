import TurndownService from "turndown";
import { markdownLanguage } from "@codemirror/lang-markdown";

const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
converter.addRule("strike", { filter: ["del", "s"], replacement: (text) => `~~${text}~~` });
// READ-04: Turndown pads list markers ("-   item", "1.  item"), so touching one
// item rewrote the spacing of every item in the list. Emit the single-space
// markers people actually type; continuation lines indent to the marker width.
converter.addRule("listItem", {
    filter: "li",
    replacement(content, node, options) {
        const parent = node.parentNode as HTMLElement | null;
        let prefix = `${options.bulletListMarker} `;
        if (parent?.nodeName === "OL") {
            const start = Number(parent.getAttribute("start")) || 1;
            prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
        }
        const paragraph = /\n$/.test(content);
        const body = (content.replace(/^\n+|\n+$/g, "") + (paragraph ? "\n" : "")).replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
        return prefix + body + (node.nextSibling ? "\n" : "");
    },
});

export interface ReaderEditRange { start: number; end: number; source: string }

/** READ-03: punctuation inside code spans/escapes is literal, not an extension.
 * Use the existing Markdown parser so multi-backtick spans are handled too. */
function unprotectedSyntax(source: string): string {
    const literal: { from: number; to: number }[] = [];
    markdownLanguage.parser.parse(source).iterate({ enter(node) {
        if (node.name === "InlineCode" || node.name === "Escape") {
            literal.push({ from: node.from, to: node.to });
            return false;
        }
    } });
    let out = "", end = 0;
    for (const span of literal) {
        out += source.slice(end, span.from) + source.slice(span.from, span.to).replace(/[^\r\n]/g, " ");
        end = span.to;
    }
    return out + source.slice(end);
}

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
    const syntax = unprotectedSyntax(source);
    if (/%%|<\/?[a-zA-Z!\?]|\[\[|!\[|\[\^|\]\s*\[|\{#|==|`{3,}|~{3,}|(?:^|\s)#[\p{L}\p{N}_-]+|\$\$|\$(?:[^\s$]|[^\s$][^\n$]*?[^\s$])\$|\^([^\s^]+)\^|(?<!~)~([^\s~]+)~(?!~)|^\s*[-*+]\s+\[[ xX]\]|^\s*>\s*\[!|^\s*\[[^\]]+\]:|^[ \t>]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\||$)/mu.test(syntax)) return null;
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

export interface ReaderChange { from: number; before: string; after: string }

/** Store only a changed span in undo history, not a full large note per key. */
export function readerChange(before: string, after: string): ReaderChange | null {
    if (before === after) return null;
    let from = 0, oldEnd = before.length, newEnd = after.length;
    while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
    while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
    return { from, before: before.slice(from, oldEnd), after: after.slice(from, newEnd) };
}

export function applyReaderChange(document: string, change: ReaderChange, undo = false): string | null {
    const source = undo ? change.after : change.before;
    return applyReaderEdit(document, { start: change.from, end: change.from + source.length, source }, undo ? change.before : change.after);
}
