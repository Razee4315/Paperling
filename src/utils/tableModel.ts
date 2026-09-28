/**
 * Pure GFM-table model + operations for Paperling's visual table editing.
 *
 * Everything here is pure: parse a markdown table block into a {headers, aligns,
 * rows} model, run row/column/alignment operations on it, and serialize back to
 * aligned, padded GFM markdown. `applyTableOp` ties it together against an
 * EditorState (text + caret) so the UI layer just calls one function and applies
 * the EditorResult — same contract as editorActions.ts.
 *
 * Serializing always re-pads columns to a uniform width, which also fixes the
 * column-drift the raw Tab-navigation left behind (every line ends up the same
 * length, so a "Format table" pass tidies hand-edited tables).
 */

import type { EditorState, EditorResult } from "./editorActions";

export type Align = "none" | "left" | "center" | "right";

export interface TableModel {
    headers: string[];
    aligns: Align[];
    rows: string[][];
}

export interface TableRegion {
    /** Offset of the start of the table's first line. */
    from: number;
    /** Offset of the end of the table's last line (no trailing newline). */
    to: number;
    /** The raw markdown of the block, i.e. text.slice(from, to). */
    text: string;
    model: TableModel;
}

export type TableOp =
    | { kind: "format" }
    | { kind: "row-above" }
    | { kind: "row-below" }
    | { kind: "row-delete" }
    | { kind: "col-left" }
    | { kind: "col-right" }
    | { kind: "col-delete" }
    | { kind: "align"; align: Align };

const SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const isPipeRow = (line: string): boolean => {
    const t = line.trim();
    return t.length > 0 && t.includes("|");
};

const isSeparatorRow = (line: string): boolean => SEPARATOR_RE.test(line) && line.includes("-");

/** Split a table row into trimmed cells, tolerating optional outer pipes and
 *  honouring escaped pipes (`\|`) as literal cell content. */
function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

function parseAlign(cell: string): Align {
    const c = cell.trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "none";
}

/** Parse the lines of a table block (header, separator, body...) into a model
 *  with a rectangular shape (every row padded/truncated to the header count). */
export function parseTable(lines: string[]): TableModel {
    const headers = splitRow(lines[0] ?? "");
    const n = headers.length;
    const aligns: Align[] = [];
    const sepCells = splitRow(lines[1] ?? "");
    for (let i = 0; i < n; i++) aligns.push(parseAlign(sepCells[i] ?? ""));
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
        const cells = splitRow(lines[i]);
        const row: string[] = [];
        for (let c = 0; c < n; c++) row.push(cells[c] ?? "");
        rows.push(row);
    }
    return { headers, aligns, rows };
}

/** Locate the contiguous markdown table block containing `pos`, or null. A valid
 *  block is a run of consecutive pipe rows whose second line is an alignment
 *  separator. */
export function findTableAt(text: string, pos: number): TableRegion | null {
    const lines = text.split("\n");
    const starts: number[] = [];
    let acc = 0;
    for (const ln of lines) {
        starts.push(acc);
        acc += ln.length + 1; // +1 for the '\n'
    }
    // Which line is the caret on? (a caret at a line's end still belongs to it)
    let caretLine = 0;
    for (let i = 0; i < lines.length; i++) {
        const start = starts[i];
        const end = start + lines[i].length;
        if (pos >= start && pos <= end) { caretLine = i; break; }
        if (pos > end) caretLine = i; // past this line; keep advancing
    }
    if (!isPipeRow(lines[caretLine])) return null;

    let top = caretLine;
    while (top > 0 && isPipeRow(lines[top - 1])) top--;
    let bot = caretLine;
    while (bot < lines.length - 1 && isPipeRow(lines[bot + 1])) bot++;

    // Need at least a header + separator, and the 2nd line must be a separator.
    if (bot - top < 1) return null;
    if (!isSeparatorRow(lines[top + 1])) return null;

    const from = starts[top];
    const to = starts[bot] + lines[bot].length;
    const model = parseTable(lines.slice(top, bot + 1));
    return { from, to, text: text.slice(from, to), model };
}

/** Which (lineIndex, colIndex) does an absolute offset land on inside a region?
 *  lineIndex: 0 = header, 1 = separator, 2.. = body rows. */
export function locateCell(region: TableRegion, pos: number): { lineIndex: number; colIndex: number } {
    const local = clamp(pos, region.from, region.to) - region.from;
    const lineIndex = countNewlines(region.text, local);
    const lineStart = nthLineStart(region.text, lineIndex);
    const localPos = Math.max(0, local - lineStart);
    const line = nthLine(region.text, lineIndex);
    // column = number of pipes before the local position, minus the leading pipe
    let pipes = 0;
    for (let i = 0; i < line.length && i < localPos; i++) if (line[i] === "|") pipes++;
    const n = region.model.headers.length;
    const colIndex = clamp(pipes - 1, 0, Math.max(0, n - 1));
    return { lineIndex, colIndex };
}

/* ---------- pure model operations ---------- */

const blankRow = (n: number): string[] => new Array(n).fill("");

export function insertColumn(m: TableModel, at: number): TableModel {
    const idx = clamp(at, 0, m.headers.length);
    return {
        headers: insertAt(m.headers, idx, ""),
        aligns: insertAt(m.aligns, idx, "none"),
        rows: m.rows.map((r) => insertAt(r, idx, "")),
    };
}

export function deleteColumn(m: TableModel, at: number): TableModel {
    if (m.headers.length <= 1) return m; // never leave a column-less table
    const idx = clamp(at, 0, m.headers.length - 1);
    return {
        headers: removeAt(m.headers, idx),
        aligns: removeAt(m.aligns, idx),
        rows: m.rows.map((r) => removeAt(r, idx)),
    };
}

export function insertRow(m: TableModel, at: number): TableModel {
    const idx = clamp(at, 0, m.rows.length);
    return { ...m, rows: insertAt(m.rows, idx, blankRow(m.headers.length)) };
}

export function deleteRow(m: TableModel, at: number): TableModel {
    if (m.rows.length === 0) return m;
    const idx = clamp(at, 0, m.rows.length - 1);
    return { ...m, rows: removeAt(m.rows, idx) };
}

export function setAlignment(m: TableModel, col: number, align: Align): TableModel {
    if (col < 0 || col >= m.aligns.length) return m;
    const aligns = m.aligns.slice();
    aligns[col] = align;
    return { ...m, aligns };
}

/* ---------- serialization ---------- */

function columnWidths(m: TableModel): number[] {
    const n = m.headers.length;
    const w = new Array<number>(n).fill(3); // separators need >= 3 dashes for ":-:"
    for (let i = 0; i < n; i++) {
        w[i] = Math.max(w[i], (m.headers[i] ?? "").length);
        for (const row of m.rows) w[i] = Math.max(w[i], (row[i] ?? "").length);
    }
    return w;
}

function padCell(content: string, width: number, align: Align): string {
    const c = content ?? "";
    if (c.length >= width) return c;
    const total = width - c.length;
    if (align === "right") return " ".repeat(total) + c;
    if (align === "center") {
        const left = Math.floor(total / 2);
        return " ".repeat(left) + c + " ".repeat(total - left);
    }
    return c + " ".repeat(total); // left / none
}

function separatorCell(width: number, align: Align): string {
    if (align === "left") return ":" + "-".repeat(width - 1);
    if (align === "right") return "-".repeat(width - 1) + ":";
    if (align === "center") return ":" + "-".repeat(width - 2) + ":";
    return "-".repeat(width);
}

export function serializeTable(m: TableModel): string {
    const w = columnWidths(m);
    const row = (cells: string[]) =>
        "|" + w.map((width, i) => " " + padCell(cells[i] ?? "", width, m.aligns[i] ?? "none") + " ").join("|") + "|";
    const sep = "|" + w.map((width, i) => " " + separatorCell(width, m.aligns[i] ?? "none") + " ").join("|") + "|";
    return [row(m.headers), sep, ...m.rows.map(row)].join("\n");
}

/** Absolute-within-table offset of the start of a cell's content, used to place
 *  the caret after an edit. Every serialized line is the same length (all cells
 *  padded to the column width), so the math is uniform. */
function caretOffset(m: TableModel, lineIndex: number, colIndex: number): number {
    const w = columnWidths(m);
    const lineLen = 1 + w.reduce((a, b) => a + b + 3, 0); // "|" + per col " <width> |"
    const totalLines = 2 + m.rows.length;
    const line = clamp(lineIndex, 0, totalLines - 1);
    const col = clamp(colIndex, 0, w.length - 1);
    let contentStart = 2; // past the leading "| "
    for (let j = 0; j < col; j++) contentStart += w[j] + 3;
    return line * (lineLen + 1) + contentStart;
}

/* ---------- the one entry point the UI calls ---------- */

/** Apply a table operation to the table under the caret. Returns a full new
 *  text + caret (EditorResult), or null if the caret isn't in a table (or the
 *  op would be invalid, e.g. deleting the only column). */
export function applyTableOp(state: EditorState, op: TableOp): EditorResult | null {
    const region = findTableAt(state.text, state.selStart);
    if (!region) return null;
    const { lineIndex, colIndex } = locateCell(region, state.selStart);
    const m = region.model;
    const bodyIndex = Math.max(0, lineIndex - 2);
    const inBody = lineIndex >= 2;

    let next: TableModel;
    let targetLine = lineIndex;
    let targetCol = colIndex;

    switch (op.kind) {
        case "format":
            next = m;
            break;
        case "align":
            next = setAlignment(m, colIndex, op.align);
            break;
        case "row-below": {
            const at = inBody ? bodyIndex + 1 : 0;
            next = insertRow(m, at);
            targetLine = at + 2;
            targetCol = 0;
            break;
        }
        case "row-above": {
            const at = inBody ? bodyIndex : 0;
            next = insertRow(m, at);
            targetLine = at + 2;
            targetCol = 0;
            break;
        }
        case "row-delete": {
            if (!inBody || m.rows.length === 0) return null; // can't delete the header
            next = deleteRow(m, bodyIndex);
            targetLine = Math.min(lineIndex, 2 + next.rows.length - 1);
            if (next.rows.length === 0) targetLine = 0; // fell back to header
            break;
        }
        case "col-left":
            next = insertColumn(m, colIndex);
            targetCol = colIndex;
            break;
        case "col-right":
            next = insertColumn(m, colIndex + 1);
            targetCol = colIndex + 1;
            break;
        case "col-delete": {
            if (m.headers.length <= 1) return null;
            next = deleteColumn(m, colIndex);
            targetCol = Math.min(colIndex, next.headers.length - 1);
            break;
        }
        default:
            return null;
    }

    const serialized = serializeTable(next);
    const text = state.text.slice(0, region.from) + serialized + state.text.slice(region.to);
    const caret = region.from + caretOffset(next, targetLine, targetCol);
    return { text, selStart: caret, selEnd: caret };
}

/* ---------- small array/offset helpers ---------- */

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

function insertAt<T>(arr: T[], idx: number, value: T): T[] {
    const out = arr.slice();
    out.splice(idx, 0, value);
    return out;
}
function removeAt<T>(arr: T[], idx: number): T[] {
    const out = arr.slice();
    out.splice(idx, 1);
    return out;
}

// Region text helpers (locateCell is the only consumer).
function countNewlines(s: string, upto: number): number {
    let n = 0;
    for (let i = 0; i < upto && i < s.length; i++) if (s[i] === "\n") n++;
    return n;
}
function nthLineStart(s: string, lineIndex: number): number {
    let idx = 0;
    for (let k = 0; k < lineIndex; k++) {
        const nl = s.indexOf("\n", idx);
        if (nl === -1) return idx;
        idx = nl + 1;
    }
    return idx;
}
function nthLine(s: string, lineIndex: number): string {
    const start = nthLineStart(s, lineIndex);
    const nl = s.indexOf("\n", start);
    return nl === -1 ? s.slice(start) : s.slice(start, nl);
}
