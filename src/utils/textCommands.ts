/**
 * Text commands from the palette and slash menu: sort lines, change case,
 * insert the date. Every code editor has these and they were missing. EDIT-01.
 *
 * Pure text helpers first, then a thin layer that turns one into a CodeMirror
 * transaction, so all of it runs in tests without a live editor.
 */

import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { upsertToc } from "./tableOfContents";

export type SortMode = "asc" | "desc" | "unique";
export type CaseMode = "upper" | "lower" | "title";

export type TextCommandId =
    | "sortAsc" | "sortDesc" | "sortUnique"
    | "upper" | "lower" | "title"
    | "date" | "datetime"
    | "toc";

/** Editor commands handled by the view itself, not as a text change. */
export type FoldCommandId = "foldAll" | "unfoldAll";

/** Fired on window to run a command in the editor. */
export const EDITOR_COMMAND_EVENT = "paperling:editor-command";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sort newline-separated lines. Numbers order by value (item 2 < item 10). */
export function sortLines(text: string, mode: SortMode): string {
    const lines = text.split("\n");
    if (mode === "unique") {
        const seen = new Set<string>();
        return lines.filter((line) => !seen.has(line) && !!seen.add(line)).sort(collator.compare).join("\n");
    }
    lines.sort(collator.compare);
    if (mode === "desc") lines.reverse();
    return lines.join("\n");
}

export function changeCase(text: string, mode: CaseMode): string {
    if (mode === "upper") return text.toUpperCase();
    if (mode === "lower") return text.toLowerCase();
    return text.toLowerCase().replace(/(^|[\s\-_([{"'/])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local date as `2026-10-31`, or `2026-10-31 14:05`. ISO order sorts in file
 *  names and reads the same in every locale. */
export function formatNow(kind: "date" | "datetime", now: Date): string {
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return kind === "date" ? date : `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function sortSpec(state: EditorState, mode: SortMode): TransactionSpec | null {
    const { from, to } = state.selection.main;
    if (from === to) return null;
    const first = state.doc.lineAt(from);
    // A selection ending at the start of a line doesn't include that line.
    const endLine = state.doc.lineAt(to);
    const last = endLine.from === to ? state.doc.line(endLine.number - 1) : endLine;
    if (last.number <= first.number) return null;
    const insert = sortLines(state.sliceDoc(first.from, last.to), mode);
    return {
        changes: { from: first.from, to: last.to, insert },
        selection: { anchor: first.from, head: first.from + insert.length },
        userEvent: "input.transform",
    };
}

function caseSpec(state: EditorState, mode: CaseMode): TransactionSpec | null {
    const spec = state.changeByRange((range) => {
        const target = range.empty ? state.wordAt(range.head) : range;
        if (!target) return { range };
        const insert = changeCase(state.sliceDoc(target.from, target.to), mode);
        return {
            changes: { from: target.from, to: target.to, insert },
            // Upper-casing can change the length ("ß" → "SS").
            range: EditorSelection.range(target.from, target.from + insert.length),
        };
    });
    return spec.changes.empty ? null : { ...spec, userEvent: "input.transform" };
}

function insertSpec(state: EditorState, text: string): TransactionSpec {
    return { ...state.replaceSelection(text), userEvent: "input.transform" };
}

/** The transaction for a command, or null when the selection gives it nothing
 *  to work on (see TEXT_COMMAND_HINTS). */
export function textCommandSpec(state: EditorState, id: TextCommandId, now: Date): TransactionSpec | null {
    switch (id) {
        case "sortAsc": return sortSpec(state, "asc");
        case "sortDesc": return sortSpec(state, "desc");
        case "sortUnique": return sortSpec(state, "unique");
        case "upper":
        case "lower":
        case "title": return caseSpec(state, id);
        case "date":
        case "datetime": return insertSpec(state, formatNow(id, now));
        case "toc": {
            const edit = upsertToc(state.doc.toString(), state.selection.main.head);
            if (!edit) return null;
            return {
                changes: { from: edit.from, to: edit.to, insert: edit.insert },
                selection: { anchor: edit.from + edit.insert.length },
                userEvent: "input.transform",
            };
        }
    }
}

/** What to tell the user when a command returns null. */
export const TEXT_COMMAND_HINTS: Partial<Record<TextCommandId, string>> = {
    sortAsc: "Select two or more lines to sort",
    sortDesc: "Select two or more lines to sort",
    sortUnique: "Select two or more lines to sort",
    upper: "Select some text first",
    lower: "Select some text first",
    title: "Select some text first",
    toc: "Add some headings first",
};
