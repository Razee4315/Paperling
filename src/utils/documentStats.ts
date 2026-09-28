/**
 * Pure markdown-document statistics. Strips frontmatter and code blocks before
 * counting prose-y things (words, sentences) so a fenced code listing doesn't
 * inflate the word count. Counts of structural elements (headings, links, etc.)
 * are taken from the raw source instead.
 *
 * `countWords` / `countSourceWords` are THE word counters for the whole app —
 * the status bar, the stats dialog, and selection counts all route through
 * here so every surface shows the same number (STATS-01).
 */

export interface DocumentStats {
    chars: number;
    charsNoSpaces: number;
    words: number;
    sentences: number;
    paragraphs: number;
    lines: number;
    headings: number;
    links: number;
    images: number;
    codeBlocks: number;
    readingTimeMin: number;
}

const stripFrontmatter = (s: string): string => s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
const stripInlineCode = (s: string): string => s.replace(/`[^`\n]*`/g, "");

/**
 * Remove fenced code blocks line-by-line. Handles both ``` and ~~~ fences and
 * treats an unclosed fence as running to the end of the document (matching how
 * markdown renderers display it). Returns the prose lines plus the number of
 * fenced blocks encountered (an unclosed trailing fence still counts as one).
 */
function stripFencedCode(s: string): { text: string; blocks: number } {
    const lines = s.split("\n");
    const out: string[] = [];
    let fence: string | null = null;
    let blocks = 0;
    for (const line of lines) {
        const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (m) {
            const ch = m[1][0];
            if (!fence) {
                fence = ch;
                blocks++;
            } else if (ch === fence) {
                fence = null;
            }
            continue;
        }
        if (!fence) out.push(line);
    }
    return { text: out.join("\n"), blocks };
}

// CJK ideographs + kana: these scripts don't use spaces, so each character
// counts as one word (the convention used by Word, Pages, and iA Writer).
const CJK_RE = /[⺀-⻿぀-ヿ㇀-㇯㐀-䶿一-鿿豈-﫿]/g;

/**
 * Count words in already-stripped prose. A token only counts when it contains
 * at least one letter or digit — so leftover markdown syntax tokens (`#`,
 * `-`, `|`, `---`, `**`) never inflate the count, while `**bold**` attached
 * to a word still counts as one word. CJK characters count individually.
 */
export function countWords(prose: string): number {
    if (!prose) return 0;
    const cjk = prose.match(CJK_RE);
    const nonCjk = cjk ? prose.replace(CJK_RE, " ") : prose;
    let words = cjk ? cjk.length : 0;
    for (const token of nonCjk.split(/\s+/)) {
        if (token && /[\p{L}\p{N}]/u.test(token)) words++;
    }
    return words;
}

/**
 * Word count for a full markdown source: strips frontmatter, fenced code and
 * inline code first, then counts prose words. This is what the status bar
 * shows; computeStats() uses the same pipeline so the numbers always agree.
 */
export function countSourceWords(source: string): number {
    if (!source) return 0;
    const { text } = stripFencedCode(stripFrontmatter(source));
    return countWords(stripInlineCode(text));
}

// Abbreviations that end with "." mid-sentence. Only suppressed when followed
// by a lowercase continuation, so "Ask Dr. Smith." still ends one sentence.
const ABBREV_RE = /\b(?:e\.g|i\.e|etc|vs|cf|Mr|Mrs|Ms|Dr|Prof|St|No|Fig|approx)\.(?=\s+[a-z(])/g;

/** Sentence terminators followed by whitespace/EOL — skips decimals like 3.14. */
const SENTENCE_END_RE = /[.!?]+(?=\s|$)/g;

export function computeStats(source: string): DocumentStats {
    const lines = source.length === 0 ? 0 : source.split("\n").length;

    const body = stripFrontmatter(source);
    const { text: noFences, blocks: codeBlocks } = stripFencedCode(body);
    const prose = stripInlineCode(noFences);

    const trimmed = prose.trim();
    const words = countWords(trimmed);

    let sentences = 0;
    if (trimmed.length > 0) {
        const ends = trimmed.match(SENTENCE_END_RE);
        const abbrevs = trimmed.match(ABBREV_RE);
        sentences = Math.max((ends ? ends.length : 0) - (abbrevs ? abbrevs.length : 0), 0);
        if (sentences === 0) sentences = 1;
    }

    const paragraphs = trimmed.length === 0
        ? 0
        : trimmed.split(/\n\s*\n+/).filter((p) => p.trim().length > 0).length;

    const headings = (body.match(/^#{1,6}\s+\S/gm) || []).length;
    // Links: inline [t](u), reference [t][ref], autolink <http://…>, wikilink [[t]].
    const inlineLinks = (body.match(/(?<!\!)\[[^\]\n]*\]\([^)\n]+\)/g) || []).length;
    const refLinks = (body.match(/(?<!\!)\[[^\]\n]+\]\[[^\]\n]*\]/g) || []).length;
    const autoLinks = (body.match(/<https?:\/\/[^>\s]+>/g) || []).length;
    const wikiLinks = (body.match(/\[\[[^\]\n]+\]\]/g) || []).length;
    const links = inlineLinks + refLinks + autoLinks + wikiLinks;
    const images = (body.match(/!\[[^\]\n]*\]\([^)\n]+\)/g) || []).length;

    return {
        chars: source.length,
        charsNoSpaces: source.replace(/\s/g, "").length,
        words,
        sentences,
        paragraphs,
        lines,
        headings,
        links,
        images,
        codeBlocks,
        readingTimeMin: words / 200,
    };
}
