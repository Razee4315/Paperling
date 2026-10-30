/**
 * `:rocket:` shortcodes (EMOJI-01). GitHub READMEs and Slack-trained fingers use
 * them everywhere, and the preview showed them as raw text.
 *
 * The name table is ~300 kB, so it loads only for a document that looks like it
 * has a shortcode, or the first time the editor can complete one.
 *
 * Replacement runs on the rendered tree AFTER heading ids exist: GitHub builds
 * `## :rocket: Launch` into `#rocket-launch`, and a README's own links depend on
 * that. Replacing earlier would turn the id into `#launch` and break them.
 */

import { rankFileNames } from "./wikilinkComplete";

export type EmojiNames = Readonly<Record<string, string>>;

let namesPromise: Promise<EmojiNames> | null = null;

export const loadEmojiNames = (): Promise<EmojiNames> => {
    if (!namesPromise) {
        namesPromise = import("gemoji").then((m) => m.nameToEmoji).catch((err) => {
            namesPromise = null; // a failed chunk load may succeed next time
            throw err;
        });
    }
    return namesPromise;
};

const SHORTCODE = /:([a-z0-9_+-]+):/gi;

/** Cheap test for "worth loading the table". */
export const hasEmojiShortcode = (text: string): boolean => /:[a-z0-9_+-]+:/i.test(text);

/** Unknown names stay as typed: `12:30:45` and `:not-an-emoji:` are just text. */
export function replaceShortcodes(text: string, names: EmojiNames): string {
    return text.replace(SHORTCODE, (whole, name: string) => (Object.prototype.hasOwnProperty.call(names, name) ? names[name] : whole));
}

interface HastNode {
    type: string;
    tagName?: string;
    value?: string;
    properties?: { className?: unknown };
    children?: HastNode[];
}

const LITERAL_TAGS = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg", "math"]);
const isLiteral = (node: HastNode) =>
    (node.tagName !== undefined && LITERAL_TAGS.has(node.tagName)) ||
    (Array.isArray(node.properties?.className) && node.properties.className.some((c) => /^katex|^math/.test(String(c))));

/** rehype plugin. Must run after heading ids are set; see the file comment. */
export function rehypeEmoji({ names }: { names: EmojiNames }) {
    return (tree: HastNode) => {
        const walk = (node: HastNode) => {
            if (node.type === "text" && node.value) node.value = replaceShortcodes(node.value, names);
            else if (!isLiteral(node)) node.children?.forEach(walk);
        };
        walk(tree);
    };
}

/** An open `:name` before the caret, or null. Two letters minimum, so typing a
 *  smiley or a colon in prose doesn't pop a list; the character before it must
 *  not be part of a word, which rules out `12:30` and `https:`. */
export function matchEmojiPrefix(textBefore: string): { from: number; query: string } | null {
    const m = /(^|[\s([{>*_~"'-]):([a-z0-9_+-]{2,})$/i.exec(textBefore);
    return m ? { from: m.index + m[1].length, query: m[2].toLowerCase() } : null;
}

export function rankEmoji(names: EmojiNames, query: string, limit = 30): { name: string; emoji: string }[] {
    return rankFileNames(Object.keys(names), query, limit).map((name) => ({ name, emoji: names[name] }));
}
