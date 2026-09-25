/**
 * Editor key-handling helpers for Paperling's CodeEditor.
 *
 * All functions are pure: they take the current text + selection and return the
 * new text + selection, or `null` if the key is not handled (so the textarea
 * default behavior runs).
 */

export interface EditorState {
    text: string;
    selStart: number;
    selEnd: number;
}

export interface EditorResult {
    text: string;
    selStart: number;
    selEnd: number;
}

const INDENT = "  "; // 2 spaces — markdown-friendly nested lists

/* ---------- Selection / line helpers ---------- */

const lineStartIndex = (text: string, pos: number): number => {
    const before = text.slice(0, pos);
    const nl = before.lastIndexOf("\n");
    return nl === -1 ? 0 : nl + 1;
};

const lineEndIndex = (text: string, pos: number): number => {
    const idx = text.indexOf("\n", pos);
    return idx === -1 ? text.length : idx;
};

/* ---------- Table cell navigation ---------- */

const isTableLine = (line: string): boolean => {
    const t = line.trim();
    return t.startsWith("|") && t.endsWith("|") && t.length > 1;
};

/**
 * Tab inside a markdown table moves to the next cell (skipping the separator
 * `| --- |` row). At the last cell of a row, jumps to row 1 of next row.
 * At the last cell of the last row, creates a new row.
 */
export function handleTableTab(state: EditorState, shift: boolean): EditorResult | null {
    const { text, selStart, selEnd } = state;
    if (selStart !== selEnd) return null;

    const ls = lineStartIndex(text, selStart);
    const le = lineEndIndex(text, selStart);
    const line = text.slice(ls, le);
    if (!isTableLine(line)) return null;

    // Find pipe positions on the current line
    const pipes: number[] = [];
    for (let i = 0; i < line.length; i++) if (line[i] === "|") pipes.push(i);
    if (pipes.length < 2) return null;

    const localPos = selStart - ls;
    let cellIdx = 0;
    for (let i = 0; i < pipes.length - 1; i++) {
        if (localPos >= pipes[i] && localPos <= pipes[i + 1]) {
            cellIdx = i;
            break;
        }
    }

    if (!shift) {
        if (cellIdx < pipes.length - 2) {
            // Next cell, place caret at content start
            const target = ls + pipes[cellIdx + 1] + 2;
            return { text, selStart: target, selEnd: target };
        }
        // Last cell — go to next row's first cell, skipping separator rows.
        // The scan treats a missing final line as "not a table row", so Tab on
        // the last cell of a table that ENDS the document still creates the
        // promised new row; the old bound (`scan < text.length`) skipped the
        // loop entirely and fell through to a plain 2-space indent. SHC-05.
        let scan = le + 1;
        for (;;) {
            const nle = scan <= text.length ? lineEndIndex(text, scan) : scan;
            const nextLine = scan <= text.length ? text.slice(scan, nle) : "";
            if (!isTableLine(nextLine)) {
                // Not a table — create a new row matching the column count
                const cols = pipes.length - 1;
                const blank = "| " + Array(cols).fill("").join(" | ") + " |";
                const inserted = "\n" + blank;
                const target = le + 3; // after first "| "
                return {
                    text: text.slice(0, le) + inserted + text.slice(le),
                    selStart: target,
                    selEnd: target,
                };
            }
            // Skip separator rows
            if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|$/.test(nextLine.trim())) {
                scan = nle + 1;
                continue;
            }
            // Found a body row — go to its first cell
            const firstPipe = scan + nextLine.indexOf("|");
            const target = firstPipe + 2;
            return { text, selStart: target, selEnd: target };
        }
    }

    // Shift+Tab — previous cell
    if (cellIdx > 0) {
        const target = ls + pipes[cellIdx - 1] + 2;
        return { text, selStart: target, selEnd: target };
    }
    // First cell — try previous row
    if (ls > 0) {
        let prevLe = ls - 1;
        while (prevLe > 0) {
            const prevLs = lineStartIndex(text, prevLe - 1);
            const prevLine = text.slice(prevLs, prevLe);
            if (!isTableLine(prevLine)) break;
            if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|$/.test(prevLine.trim())) {
                prevLe = prevLs - 1;
                continue;
            }
            // Last cell of prev row
            const prevPipes: number[] = [];
            for (let i = 0; i < prevLine.length; i++) if (prevLine[i] === "|") prevPipes.push(i);
            const target = prevLs + prevPipes[prevPipes.length - 2] + 2;
            return { text, selStart: target, selEnd: target };
        }
    }
    return null;
}

/* ---------- Tab / Shift+Tab ---------- */

export function handleTab(state: EditorState, shift: boolean): EditorResult | null {
    // Try table-tab first; falls through to indent if not in a table.
    const tableResult = handleTableTab(state, shift);
    if (tableResult) return tableResult;

    const { text, selStart, selEnd } = state;

    // Multi-line: indent or outdent each line in the selection
    const hasNewline = text.slice(selStart, selEnd).includes("\n");
    if (selStart !== selEnd && hasNewline) {
        const blockStart = lineStartIndex(text, selStart);
        const blockEnd = lineEndIndex(text, selEnd);
        const block = text.slice(blockStart, blockEnd);
        const lines = block.split("\n");

        let newBlock: string;
        if (shift) {
            newBlock = lines.map((l) => l.startsWith(INDENT) ? l.slice(INDENT.length) : l.startsWith(" ") ? l.slice(1) : l).join("\n");
        } else {
            newBlock = lines.map((l) => INDENT + l).join("\n");
        }

        const newText = text.slice(0, blockStart) + newBlock + text.slice(blockEnd);
        const delta = newBlock.length - block.length;
        return {
            text: newText,
            selStart: blockStart,
            selEnd: blockEnd + delta,
        };
    }

    // Single-line: insert / remove indent at cursor
    if (shift) {
        const ls = lineStartIndex(text, selStart);
        const head = text.slice(ls, ls + INDENT.length);
        if (head === INDENT) {
            return {
                text: text.slice(0, ls) + text.slice(ls + INDENT.length),
                selStart: Math.max(ls, selStart - INDENT.length),
                selEnd: Math.max(ls, selEnd - INDENT.length),
            };
        }
        return null;
    }

    // Single-line selection: indent the containing LINE (like the multi-line
    // branch) and keep the selection. The old code spliced INDENT at the caret
    // with `text.slice(selEnd)` — deleting the selected text. SHC-04.
    if (selStart !== selEnd) {
        const blockStart = lineStartIndex(text, selStart);
        return {
            text: text.slice(0, blockStart) + INDENT + text.slice(blockStart),
            selStart: selStart + INDENT.length,
            selEnd: selEnd + INDENT.length,
        };
    }

    return {
        text: text.slice(0, selStart) + INDENT + text.slice(selStart),
        selStart: selStart + INDENT.length,
        selEnd: selStart + INDENT.length,
    };
}

/* ---------- Enter: list continuation ---------- */

const LIST_PATTERN = /^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/;
const QUOTE_PATTERN = /^(\s*>\s+)/;

export function handleEnter(state: EditorState): EditorResult | null {
    const { text, selStart, selEnd } = state;
    if (selStart !== selEnd) return null;

    const ls = lineStartIndex(text, selStart);
    const currentLine = text.slice(ls, selStart);

    // Blockquote continuation
    const qm = currentLine.match(QUOTE_PATTERN);
    if (qm) {
        // If only the quote prefix is on the line, terminate the quote
        if (currentLine.trim() === ">") {
            return {
                text: text.slice(0, ls) + "\n" + text.slice(selStart),
                selStart: ls + 1,
                selEnd: ls + 1,
            };
        }
        const insert = "\n" + qm[1];
        return {
            text: text.slice(0, selStart) + insert + text.slice(selEnd),
            selStart: selStart + insert.length,
            selEnd: selStart + insert.length,
        };
    }

    // List continuation
    const lm = currentLine.match(LIST_PATTERN);
    if (lm) {
        const indent = lm[1];
        const marker = lm[2];
        const taskBox = lm[3] ? "[ ] " : "";
        const restAfterPrefix = currentLine.slice(lm[0].length);

        // Empty list item — terminate the list
        if (restAfterPrefix.trim() === "") {
            return {
                text: text.slice(0, ls) + "\n" + text.slice(selStart),
                selStart: ls + 1,
                selEnd: ls + 1,
            };
        }

        // Numbered list: increment the new item's marker AND renumber the
        // same-indent items below it (2.→3.→4. …, stopping at the first line
        // that breaks the chain). The old code only incremented the new item,
        // leaving the rest of the list stale after any insert. SHC-06.
        let nextMarker = marker;
        const lineEnd = lineEndIndex(text, selStart);
        const remainder = text.slice(selStart, lineEnd); // rest of the caret line ("" at line end)
        const newline = text.slice(lineEnd, lineEnd + 1); // the line's "\n", or "" at EOF
        const afterLine = text.slice(lineEnd + 1); // lines after the caret line
        let tail: string;
        const numMatch = marker.match(/^(\d+)\.$/);
        if (numMatch && afterLine) {
            const current = parseInt(numMatch[1], 10);
            nextMarker = `${current + 1}.`;
            const restLines = afterLine.split("\n");
            let expected = current + 2;
            for (let i = 0; i < restLines.length; i++) {
                const m = restLines[i].match(/^(\s*)(\d+)(\.\s)/);
                if (!m || m[1] !== indent || parseInt(m[2], 10) !== expected - 1) break;
                restLines[i] = `${m[1]}${expected}${m[3]}` + restLines[i].slice(m[0].length);
                expected++;
            }
            tail = remainder + newline + restLines.join("\n");
        } else {
            if (numMatch) nextMarker = `${parseInt(numMatch[1], 10) + 1}.`;
            tail = remainder + newline + afterLine;
        }

        const insert = `\n${indent}${nextMarker} ${taskBox}`;
        return {
            text: text.slice(0, selStart) + insert + tail,
            selStart: selStart + insert.length,
            selEnd: selStart + insert.length,
        };
    }

    return null;
}

/* ---------- Bold / Italic / Link ---------- */

export function wrapSelection(
    state: EditorState,
    left: string,
    right: string = left,
    placeholder: string = ""
): EditorResult {
    const { text, selStart, selEnd } = state;
    const selected = text.slice(selStart, selEnd) || placeholder;

    // Toggle, case 1: the selection carries its OWN markers (e.g. "**bold**"
    // selected, Ctrl+B pressed) — strip them. The outside-marker check below
    // can't see this case and used to double-wrap. SHC-07. Symmetric pairs
    // only: an asymmetric wrap like [x](y) has no meaningful inside form.
    if (
        selStart !== selEnd &&
        right === left &&
        selected.length > left.length + right.length &&
        selected.startsWith(left) &&
        selected.endsWith(right)
    ) {
        const inner = selected.slice(left.length, selected.length - right.length);
        return {
            text: text.slice(0, selStart) + inner + text.slice(selEnd),
            selStart,
            selEnd: selStart + inner.length,
        };
    }

    // Toggle, case 2: the markers sit just OUTSIDE the selection.
    const beforeSel = text.slice(Math.max(0, selStart - left.length), selStart);
    const afterSel = text.slice(selEnd, selEnd + right.length);
    if (selStart !== selEnd && beforeSel === left && afterSel === right) {
        return {
            text: text.slice(0, selStart - left.length) + selected + text.slice(selEnd + right.length),
            selStart: selStart - left.length,
            selEnd: selEnd - left.length,
        };
    }

    const wrapped = left + selected + right;
    return {
        text: text.slice(0, selStart) + wrapped + text.slice(selEnd),
        selStart: selStart + left.length,
        selEnd: selStart + left.length + selected.length,
    };
}

export function insertLink(state: EditorState): EditorResult {
    const { text, selStart, selEnd } = state;
    const selected = text.slice(selStart, selEnd);
    const isUrl = /^https?:\/\//i.test(selected);
    const linkText = isUrl ? "" : selected;
    const url = isUrl ? selected : "url";
    const inserted = `[${linkText}](${url})`;
    const newText = text.slice(0, selStart) + inserted + text.slice(selEnd);
    // Place caret inside whichever part is empty
    const caret = isUrl
        ? selStart + 1 // inside [|]
        : selStart + linkText.length + 3; // inside (|)
    return {
        text: newText,
        selStart: caret,
        selEnd: isUrl ? caret : caret + url.length,
    };
}
