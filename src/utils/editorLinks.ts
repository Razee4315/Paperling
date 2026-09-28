/**
 * Which link (if any) sits under a caret/click position on one source line,
 * for Ctrl/Cmd+click navigation in the editor. NAV-11.
 *
 * In the reader every link is clickable, but in the editor a link was just
 * text: following a [[wikilink]] or a URL meant switching to Reader first.
 * Obsidian and VS Code both follow links on Ctrl/Cmd+click in the source.
 */

export type EditorLink =
    | { kind: "wikilink"; target: string }
    | { kind: "url"; target: string }
    | { kind: "anchor"; target: string }
    | { kind: "relative"; target: string };

const WIKILINK = /!?\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\]/g;
// [text](href "title") and ![alt](src); the href stops at whitespace or ")".
const MD_LINK = /!?\[(?:[^\]\n]|\](?!\())*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const AUTOLINK = /<((?:https?|mailto):[^>\s]+)>/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/g;

function classify(href: string): EditorLink | null {
    const h = href.trim();
    if (!h) return null;
    if (/^(https?:|mailto:)/i.test(h)) return { kind: "url", target: h };
    if (/^www\./i.test(h)) return { kind: "url", target: `https://${h}` };
    if (h.startsWith("#")) return h.length > 1 ? { kind: "anchor", target: decodeURIComponent(h.slice(1)) } : null;
    // Any other scheme (javascript:, file:, data:) is never followed.
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
    return { kind: "relative", target: h };
}

/** The link covering 0-based column `col` of `line`, or null. */
export function linkAt(line: string, col: number): EditorLink | null {
    const within = (m: RegExpMatchArray) => m.index !== undefined && col >= m.index && col <= m.index + m[0].length;
    for (const m of line.matchAll(WIKILINK)) {
        if (within(m)) return { kind: "wikilink", target: m[1].trim() };
    }
    for (const m of line.matchAll(MD_LINK)) {
        if (within(m)) return classify(m[1]);
    }
    for (const m of line.matchAll(AUTOLINK)) {
        if (within(m)) return classify(m[1]);
    }
    for (const m of line.matchAll(BARE_URL)) {
        if (within(m)) return classify(m[0]);
    }
    return null;
}
