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
export function isValidPattern(needle: string, regex: boolean): boolean {
    if (!regex || !needle) return true;
    try {
        new RegExp(needle);
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
 * All start indices of `needle` in `haystack`, left to right. Returns `[]` for
 * an empty needle or an invalid regex. Matches never overlap: plain mode steps
 * past each hit, and regex mode advances past zero-width matches so a pattern
 * like `a*` can't loop forever.
 */
export function findAll(haystack: string, needle: string, caseSensitive: boolean, regex: boolean): number[] {
    if (!needle) return [];
    const result: number[] = [];

    if (regex) {
        try {
            const re = new RegExp(needle, caseSensitive ? "g" : "gi");
            let m: RegExpExecArray | null;
            while ((m = re.exec(haystack)) !== null) {
                result.push(m.index);
                if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loops
            }
        } catch {
            return [];
        }
        return result;
    }

    const h = caseSensitive ? haystack : haystack.toLowerCase();
    const n = caseSensitive ? needle : needle.toLowerCase();
    let i = h.indexOf(n);
    while (i !== -1) {
        result.push(i);
        i = h.indexOf(n, i + Math.max(1, n.length));
    }
    return result;
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
            const re = new RegExp(needle, caseSensitive ? "g" : "gi");
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
 * Expand `$1`…`$9`, `$&` (whole match) and `$$` (a literal `$`) in a regex
 * replacement template, mirroring `String.prototype.replace` semantics. Without
 * this, `$1` would be inserted literally — defeating the point of regex mode.
 * An out-of-range group reference (e.g. `$7` with two groups) is left verbatim.
 */
export function expandReplacement(m: RegExpExecArray, template: string): string {
    return template.replace(/\$(\$|&|[1-9])/g, (whole, g: string) => {
        if (g === "$") return "$";
        if (g === "&") return m[0];
        const idx = Number(g);
        return idx < m.length ? (m[idx] ?? "") : whole;
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
            const re = new RegExp(query, caseSensitive ? "g" : "gi");
            re.lastIndex = start;
            const m = re.exec(content);
            if (!m || m.index !== start) return null;
            len = m[0].length;
            actual = expandReplacement(m, replacement);
        } catch {
            return null;
        }
    } else {
        len = query.length;
    }

    if (len === 0) return null;
    const next = content.slice(0, start) + actual + content.slice(start + len);
    return { content: next, cursor: start + actual.length };
}

/**
 * Replace every match in `content`. Regex mode defers to the native
 * `String.replace` (one pass, correct `$n` expansion and zero-width handling);
 * plain mode splices the precomputed `matches` in reverse so earlier indices
 * stay valid. The caret is kept near the first replacement rather than jumped
 * to the end of the document. Returns `null` when there's nothing to do or the
 * regex is invalid.
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
            updated = content.replace(new RegExp(query, caseSensitive ? "g" : "gi"), replacement);
        } catch {
            return null;
        }
    } else {
        updated = content;
        for (let i = matches.length - 1; i >= 0; i--) {
            const start = matches[i];
            updated = updated.slice(0, start) + replacement + updated.slice(start + query.length);
        }
    }

    return { content: updated, cursor: Math.min(matches[0] + replacement.length, updated.length) };
}
