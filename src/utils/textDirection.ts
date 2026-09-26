/**
 * Right-to-left text support (issue #216, BIDI-01..03).
 *
 * Paperling rendered every line left-to-right, so Arabic, Hebrew, Persian or
 * Urdu notes started at the wrong edge in both the editor and the preview,
 * and there was no way to flip them. Every serious editor handles this:
 * GitHub gives each paragraph `dir="auto"`, Notepad / every Win32 edit
 * control flips the reading order on Ctrl+Right Shift.
 *
 * The model here:
 *   - "auto" (default): each line / block takes the direction of its first
 *     strong character. A document without RTL text renders byte-for-byte as
 *     before — no attribute is emitted for LTR blocks at the top level.
 *   - "rtl" / "ltr": a forced direction for the whole document.
 *
 * Detection is ours (not the browser's `dir="auto"`) so the editor and the
 * preview always agree, markdown markers (`#`, `-`, `>`) and inline code are
 * skipped, and the rule is unit-testable.
 */

export type TextDirection = "auto" | "ltr" | "rtl";

export const TEXT_DIRECTIONS: readonly TextDirection[] = ["auto", "ltr", "rtl"];

export function isTextDirection(v: unknown): v is TextDirection {
    return v === "auto" || v === "ltr" || v === "rtl";
}

// Strong right-to-left scripts: Hebrew, Arabic (+ supplements / extended /
// presentation forms), Syriac, Thaana, N'Ko, Samaritan, Mandaic, and the
// astral RTL blocks (Imperial Aramaic … Adlam, Arabic math symbols).
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
// Any other letter is a strong LTR character. Digits, punctuation, spaces and
// markdown markers are neutral and skipped, as in the Unicode bidi algorithm.
const LETTER = /\p{L}/u;

/**
 * The direction of the first strong character in `text`, or null when it has
 * none (blank lines, `---`, a line of numbers). This is the P2/P3 rule of the
 * Unicode bidi algorithm, which is what `dir="auto"` does in browsers.
 */
export function firstStrongDirection(text: string): "ltr" | "rtl" | null {
    for (const ch of text) {
        if (RTL_CHAR.test(ch)) return "rtl";
        if (LETTER.test(ch)) return "ltr";
    }
    return null;
}

/**
 * Like firstStrongDirection, but for one line of markdown SOURCE: skips inline
 * code spans and the URL half of links/images, so "`npm` تثبيت" or
 * "[رابط](https://x.y)" are detected by their prose, not their syntax.
 */
export function lineDirection(line: string): "ltr" | "rtl" | null {
    const prose = line
        .replace(/`[^`]*`/g, " ")
        .replace(/\]\([^)]*\)/g, "] ")
        .replace(/<[^>]*>/g, " ");
    return firstStrongDirection(prose);
}

// ─── Preview: rehype plugin ────────────────────────────────────────────────

interface HastNode {
    type: string;
    tagName?: string;
    value?: string;
    properties?: Record<string, unknown>;
    children?: HastNode[];
}

// Blocks that get a direction of their own: the ones GitHub marks (headings,
// paragraphs, lists) plus quotes, tables and callouts, whose quote bar /
// column order must follow their content too. List ITEMS are deliberately
// not here: an item flipped against its list would hang its bullet in the
// unpadded side and clip it, so a list takes one direction as a whole.
const DIR_BLOCKS = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "blockquote", "table", "dl", "dt", "dd", "details", "summary",
]);
// Never re-directed and never scanned: code is always LTR, math is laid out
// by KaTeX, and neither says anything about the prose direction.
const SKIP_TAGS = new Set(["pre", "code", "kbd", "samp", "svg", "math", "script", "style"]);

function isSkipped(node: HastNode): boolean {
    if (node.tagName && SKIP_TAGS.has(node.tagName)) return true;
    const cls = node.properties?.className;
    return Array.isArray(cls) && cls.some((c) => typeof c === "string" && c.startsWith("katex"));
}

function firstStrongInTree(node: HastNode): "ltr" | "rtl" | null {
    if (node.type === "text") return firstStrongDirection(node.value ?? "");
    if (node.type !== "element" && node.type !== "root") return null;
    if (isSkipped(node)) return null;
    for (const child of node.children ?? []) {
        const d = firstStrongInTree(child);
        if (d) return d;
    }
    return null;
}

/**
 * rehype plugin: give each block the direction of its first strong character.
 * Only emits `dir` where it differs from what the block would inherit, so a
 * purely LTR document gets no attributes at all (the preview, the exported
 * HTML and the scroll-sync line map are unchanged for existing documents),
 * and an English paragraph inside an Arabic quote is switched back to LTR.
 * Runs after rehypeSanitize with a constant value, so the schema stays strict.
 */
export function rehypeBlockDirection() {
    return (tree: HastNode) => {
        const walk = (nodes: HastNode[] | undefined, inherited: "ltr" | "rtl") => {
            if (!nodes) return;
            for (const node of nodes) {
                if (node.type !== "element" || isSkipped(node)) continue;
                let own = inherited;
                if (node.tagName && DIR_BLOCKS.has(node.tagName)) {
                    const d = firstStrongInTree(node);
                    if (d && d !== inherited) {
                        node.properties = node.properties || {};
                        node.properties.dir = d;
                        own = d;
                    }
                }
                walk(node.children, own);
            }
        };
        walk(tree.children, "ltr");
    };
}

// ─── Ctrl+Shift reading-order chord (Windows convention) ───────────────────

/**
 * Win32 edit controls (Notepad, WordPad, Outlook) switch the reading order
 * with a MODIFIER-ONLY chord: Ctrl + Right Shift = right-to-left, Ctrl + Left
 * Shift = left-to-right, fired when the keys are released with nothing else
 * pressed in between. Ctrl+Shift+<key> shortcuts therefore never trigger it.
 *
 * Paperling maps Left Shift to "auto" rather than a forced "ltr": Left
 * Ctrl+Shift is also a common Windows input-language hotkey, and forcing LTR
 * on every language switch would silently undo the per-line detection an RTL
 * writer relies on. For a Latin-script document "auto" IS left-to-right.
 */
export interface DirectionChordKey {
    key: string;
    /** KeyboardEvent.location: 1 = left, 2 = right. */
    location: number;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

export function createDirectionChord() {
    let armed = false;
    let shiftSide = 0;
    return {
        keydown(e: DirectionChordKey): void {
            if (e.key === "Shift") shiftSide = e.location;
            if (e.key === "Control" || e.key === "Shift") {
                // AltGr arrives as Ctrl+Alt on Windows; never a direction chord.
                armed = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
            } else {
                // Any real key (Ctrl+Shift+F, Ctrl+Shift+V, …) cancels the chord.
                armed = false;
            }
        },
        /** Returns the direction to switch to, or null when this keyup is not a chord. */
        keyup(e: DirectionChordKey): "rtl" | "auto" | null {
            if (!armed || (e.key !== "Control" && e.key !== "Shift")) return null;
            armed = false;
            if (shiftSide === 2) return "rtl";
            if (shiftSide === 1) return "auto";
            return null;
        },
        reset(): void {
            armed = false;
        },
    };
}
