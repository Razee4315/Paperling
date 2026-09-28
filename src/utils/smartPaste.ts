/**
 * Smart-paste rules — examined in order. The first one that returns a
 * non-null EditorResult wins; otherwise default paste behavior runs.
 */

import type { EditorResult, EditorState } from "./editorActions";

const URL_RE = /^https?:\/\/\S+$/;

/** If user pastes a URL on a non-empty selection, wrap it as `[selection](url)`. */
export function pasteUrlOnSelection(state: EditorState, pasted: string): EditorResult | null {
    if (state.selStart === state.selEnd) return null;
    const trimmed = pasted.trim();
    if (!URL_RE.test(trimmed)) return null;
    const selected = state.text.slice(state.selStart, state.selEnd);
    const inserted = `[${selected}](${trimmed})`;
    return {
        text: state.text.slice(0, state.selStart) + inserted + state.text.slice(state.selEnd),
        selStart: state.selStart + inserted.length,
        selEnd: state.selStart + inserted.length,
    };
}

/** Paste plain URL on empty selection → autolink `<url>`. */
export function pasteUrlAutolink(state: EditorState, pasted: string): EditorResult | null {
    if (state.selStart !== state.selEnd) return null;
    const trimmed = pasted.trim();
    if (!URL_RE.test(trimmed)) return null;
    const inserted = `<${trimmed}>`;
    return {
        text: state.text.slice(0, state.selStart) + inserted + state.text.slice(state.selEnd),
        selStart: state.selStart + inserted.length,
        selEnd: state.selStart + inserted.length,
    };
}

/** TSV (or 2+ tab-separated rows) → GFM markdown table. */
export function pasteTsvAsTable(state: EditorState, pasted: string): EditorResult | null {
    if (!pasted.includes("\t")) return null;
    const rows = pasted.replace(/\r\n/g, "\n").split("\n").filter((r) => r.length > 0);
    if (rows.length < 1) return null;
    const cells = rows.map((r) => r.split("\t"));
    const cols = Math.max(...cells.map((r) => r.length));
    if (cols < 2) return null;

    // Pad short rows so every row has the same number of columns
    const padded = cells.map((r) => {
        const out = [...r];
        while (out.length < cols) out.push("");
        return out;
    });

    // First row is headers; if there's only one row, synthesize headers
    const headers = padded[0];
    const body = padded.slice(1);
    const sep = headers.map(() => "---");
    const lines = [
        `| ${headers.map(escapeCell).join(" | ")} |`,
        `| ${sep.join(" | ")} |`,
        ...body.map((r) => `| ${r.map(escapeCell).join(" | ")} |`),
    ];
    const table = lines.join("\n");

    // If we're in the middle of a line, ensure the table starts on a fresh line
    const before = state.text.slice(0, state.selStart);
    const needsLeadingNl = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const inserted = needsLeadingNl + table + "\n";

    return {
        text: state.text.slice(0, state.selStart) + inserted + state.text.slice(state.selEnd),
        selStart: state.selStart + inserted.length,
        selEnd: state.selStart + inserted.length,
    };
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/**
 * HTML → markdown via turndown. Loaded lazily so the bundle stays small for
 * users who never paste rich content.
 */
let turndownPromise: Promise<{ turndownService: import("turndown") }> | null = null;
const loadTurndown = () => {
    if (turndownPromise) return turndownPromise;
    turndownPromise = import("turndown").then((mod) => {
        const TurndownService = mod.default;
        const ts = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            bulletListMarker: "-",
            emDelimiter: "*",
        });
        // GFM strikethrough + tables — turndown core doesn't ship them, but the
        // tiny rules below cover the common cases.
        ts.addRule("strikethrough", {
            filter: ["del", "s"] as Array<keyof HTMLElementTagNameMap>,
            replacement: (content: string) => `~~${content}~~`,
        });
        return { turndownService: ts };
    });
    return turndownPromise;
};

export async function htmlToMarkdown(html: string): Promise<string> {
    const { turndownService } = await loadTurndown();
    return turndownService.turndown(html);
}
