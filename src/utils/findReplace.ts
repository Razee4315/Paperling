// Pure find-and-replace primitives, extracted so the editor's find/search
// and replacement logic can be unit-tested in isolation (the component only
// wires these to inputs and the editor). Plain-text and regex modes are both
// supported; invalid regex is treated as "no match" rather than throwing, so a
// half-typed pattern never breaks the editor. QUALITY-01.

export interface FindOptions {
    caseSensitive: boolean;
    regex: boolean;
}

/**
 * Whether `needle` is a usable search pattern. Plain text is always valid; in
 * regex mode a pattern the engine can't compile (a half-typed `[`, a stray
 * `\d++`) is not. Lets the UI tell "invalid pattern" apart from "no matches",
 * which `findAll` collapses into the same empty result.
 */
export const MAX_FIND_MATCHES = 10_000;
const ASCII_ONLY = /^[\x00-\x7F]*$/;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface TextMatch {
    from: number;
    to: number;
}

/**
 * Whether `needle` is a usable search pattern. Plain text is always valid; in
 * regex mode a pattern the engine can't compile (a half-typed `[`, a stray
 * `\d++`) is not. Lets the UI tell "invalid pattern" apart from "no matches",
 * which `findAll` collapses into the same empty result.
 */
export function isValidPattern(needle: string, regex: boolean): boolean {
    if (!regex || !needle) return true;
    try {
        new RegExp(needle, "m");
        return true;
    } catch {
        return false;
    }
}

export interface ReplaceResult {
    /** The full document text after the replacement. */
    content: string;
    /** Where the caret should land afterwards. */
    cursor: number;
}

/**
 * All `[from, to)` match spans of `needle` in `haystack`, left to right.
 * Returns `[]` for an empty needle or invalid regex, advances past zero-width
 * matches, caps at MAX_FIND_MATCHES, and keeps UTF-16 indices accurate on
 * Unicode characters whose `.toLowerCase()` changes length (e.g. Turkish `İ`).
 */
export function findAllMatches(haystack: string, needle: string, caseSensitive: boolean, regex: boolean): TextMatch[] {
    if (!needle) return [];
    const result: TextMatch[] = [];

    if (regex) {
        try {
            const re = new RegExp(needle, caseSensitive ? "gm" : "gim");
            let m: RegExpExecArray | null;
            while ((m = re.exec(haystack)) !== null) {
                result.push({ from: m.index, to: m.index + m[0].length });
                if (result.length >= MAX_FIND_MATCHES) break;
                if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loops
            }
        } catch {
            return [];
        }
        return result;
    }

    if (caseSensitive || (ASCII_ONLY.test(haystack) && ASCII_ONLY.test(needle))) {
        const h = caseSensitive ? haystack : haystack.toLowerCase();
        const n = caseSensitive ? needle : needle.toLowerCase();
        let i = h.indexOf(n);
        while (i !== -1) {
            result.push({ from: i, to: i + n.length });
            if (result.length >= MAX_FIND_MATCHES) break;
            i = h.indexOf(n, i + Math.max(1, n.length));
        }
        return result;
    }

    const re = new RegExp(escapeRegExp(needle), "giu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
        result.push({ from: m.index, to: m.index + m[0].length });
        if (result.length >= MAX_FIND_MATCHES) break;
        if (m.index === re.lastIndex) re.lastIndex++;
    }
    return result;
}

/**
 * All start indices of `needle` in `haystack`, left to right. Returns `[]` for
 * an empty needle or an invalid regex. Matches never overlap: plain mode steps
 * past each hit, and regex mode advances past zero-width matches so a pattern
 * like `a*` can't loop forever.
 */
export function findAll(haystack: string, needle: string, caseSensitive: boolean, regex: boolean): number[] {
    return findAllMatches(haystack, needle, caseSensitive, regex).map((m) => m.from);
}

/**
 * Length of the match that begins exactly at `idx`. Plain mode is just the
 * needle length; regex mode re-runs the pattern anchored at `idx` and returns
 * the matched length there, or `0` if nothing matches at that position (or the
 * regex is invalid).
 */
export function matchLength(haystack: string, idx: number, needle: string, caseSensitive: boolean, regex: boolean): number {
    if (regex) {
        try {
            const re = new RegExp(needle, caseSensitive ? "gm" : "gim");
            re.lastIndex = idx;
            const m = re.exec(haystack);
            return m && m.index === idx ? m[0].length : 0;
        } catch {
            return 0;
        }
    }
    return needle.length;
}

/**
 * Expand `$1`…`$99`, `$<name>`, `$&`, `` $` ``, `$'`, and `$$` in a regex
 * replacement template, mirroring `String.prototype.replace` semantics.
 */
export function expandReplacement(m: RegExpExecArray, template: string): string {
    return template.replace(/\$(\$|&|`|\'|[0-9]{1,2}|<([^>]+)>)/g, (whole, g: string, named?: string) => {
        if (g === "$") return "$";
        if (g === "&") return m[0];
        if (g === "`") return m.input.slice(0, m.index);
        if (g === "'") return m.input.slice(m.index + m[0].length);
        if (named !== undefined) {
            return m.groups && Object.prototype.hasOwnProperty.call(m.groups, named)
                ? (m.groups[named] ?? "")
                : whole;
        }
        const idx = Number(g);
        if (idx >= 1 && idx < m.length) return m[idx] ?? "";
        return whole;
    });
}

/**
 * Replace the single match starting at `start`. In regex mode the pattern must
 * actually match at `start` (and supports `$n`/`$&`/`$$` in the replacement).
 * Returns `null` when there's nothing valid to replace (no match at `start`, a
 * zero-length match, or an invalid regex) so the caller can no-op cleanly.
 */
export function replaceOne(
    content: string,
    start: number,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    regex: boolean
): ReplaceResult | null {
    let len: number;
    let actual = replacement;

    if (regex) {
        try {
            const re = new RegExp(query, caseSensitive ? "gm" : "gim");
            re.lastIndex = start;
            const m = re.exec(content);
            if (!m || m.index !== start) return null;
            len = m[0].length;
            actual = expandReplacement(m, replacement);
        } catch {
            return null;
        }
    } else if (caseSensitive || (ASCII_ONLY.test(content) && ASCII_ONLY.test(query))) {
        len = query.length;
    } else {
        const re = new RegExp(escapeRegExp(query), "giu");
        re.lastIndex = start;
        const m = re.exec(content);
        if (!m || m.index !== start) return null;
        len = m[0].length;
    }

    if (len === 0) return null;
    const next = content.slice(0, start) + actual + content.slice(start + len);
    return { content: next, cursor: start + actual.length };
}

/**
 * Replace every match in `content`. Regex mode defers to native `String.replace`;
 * plain mode stitches precomputed matches in a single O(N) pass. The caret is
 * kept near the first replacement rather than jumped to the end of the document.
 * Returns `null` when there's nothing to do or the regex is invalid.
 */
export function replaceAllMatches(
    content: string,
    matches: number[],
    query: string,
    replacement: string,
    caseSensitive: boolean,
    regex: boolean
): ReplaceResult | null {
    if (matches.length === 0) return null;

    let updated: string;
    if (regex) {
        try {
            updated = content.replace(new RegExp(query, caseSensitive ? "gm" : "gim"), replacement);
        } catch {
            return null;
        }
    } else if (caseSensitive || (ASCII_ONLY.test(content) && ASCII_ONLY.test(query))) {
        const parts: string[] = [];
        let cursor = 0;
        for (const start of matches) {
            if (start < cursor) continue;
            parts.push(content.slice(cursor, start), replacement);
            cursor = start + query.length;
        }
        parts.push(content.slice(cursor));
        updated = parts.join("");
    } else {
        const spans = findAllMatches(content, query, false, false);
        if (spans.length === 0) return null;
        const parts: string[] = [];
        let cursor = 0;
        for (const span of spans) {
            parts.push(content.slice(cursor, span.from), replacement);
            cursor = span.to;
        }
        parts.push(content.slice(cursor));
        updated = parts.join("");
    }

    return { content: updated, cursor: Math.min(matches[0] + replacement.length, updated.length) };
}
