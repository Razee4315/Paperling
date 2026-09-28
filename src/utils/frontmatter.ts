/**
 * Lightweight YAML-frontmatter parser.
 *
 * Handles the subset of YAML that's actually used in markdown frontmatter:
 *   - scalar values (strings, numbers, booleans)
 *   - inline arrays: tags: [a, b, c]
 *   - block arrays: tags:\n  - a\n  - b
 *
 * Anything more exotic is preserved as a raw string so we don't lose data.
 */

export type FrontmatterValue = string | number | boolean | string[];

export interface FrontmatterResult {
    /** Body markdown with the frontmatter block stripped. */
    body: string;
    /** Parsed key-value map. Empty object if no frontmatter present. */
    data: Record<string, FrontmatterValue>;
    /** True if the source started with a valid `---\n...\n---\n` block. */
    hasFrontmatter: boolean;
}

const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const stripQuotes = (s: string): string => {
    const t = s.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
    }
    return t;
};

const coerceScalar = (raw: string): string | number | boolean => {
    const t = raw.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
    return stripQuotes(t);
};

const parseInlineArray = (raw: string): string[] => {
    const inner = raw.trim().slice(1, -1); // remove [ ]
    if (!inner.trim()) return [];
    return inner.split(",").map((s) => stripQuotes(s.trim()));
};

export function parseFrontmatter(source: string): FrontmatterResult {
    const match = source.match(FM_REGEX);
    if (!match) {
        return { body: source, data: {}, hasFrontmatter: false };
    }

    const yaml = match[1];
    const body = source.slice(match[0].length);
    const data: Record<string, string | number | boolean | string[]> = {};

    const lines = yaml.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            i++;
            continue;
        }

        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) {
            i++;
            continue;
        }

        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();

        // Inline array: tags: [a, b, c]
        if (value.startsWith("[") && value.endsWith("]")) {
            data[key] = parseInlineArray(value);
            i++;
            continue;
        }

        // Block array: next non-empty lines start with "- "
        if (value === "") {
            const items: string[] = [];
            let j = i + 1;
            while (j < lines.length) {
                const next = lines[j];
                const ntrim = next.trim();
                if (!ntrim) { j++; continue; }
                if (next.startsWith("  - ") || next.startsWith("- ")) {
                    items.push(stripQuotes(ntrim.replace(/^-\s*/, "")));
                    j++;
                } else {
                    break;
                }
            }
            if (items.length > 0) {
                data[key] = items;
                i = j;
                continue;
            }
        }

        data[key] = coerceScalar(value);
        i++;
    }

    return { body, data, hasFrontmatter: true };
}

const formatScalar = (v: string | number | boolean): string => {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return String(v);
    // Quote strings only if they contain colon, special chars, or look like a number/bool
    if (/^(true|false|\d+(\.\d+)?)$/.test(v) || /[:#&*!|>'"]/.test(v) || v.includes("\n")) {
        return `"${v.replace(/"/g, '\\"')}"`;
    }
    return v;
};

const formatValue = (v: FrontmatterValue): string => {
    if (Array.isArray(v)) {
        return `[${v.map((s) => formatScalar(s)).join(", ")}]`;
    }
    return formatScalar(v);
};

/** Serialize a parsed frontmatter map back into a `---` block + the body. */
export function serializeFrontmatter(data: Record<string, FrontmatterValue>, body: string): string {
    const lines = Object.entries(data).map(([k, v]) => `${k}: ${formatValue(v)}`);
    if (lines.length === 0) return body;
    return `---\n${lines.join("\n")}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}
