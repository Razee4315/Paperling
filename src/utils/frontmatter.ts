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
    /** Keys whose YAML structure is nested/multiline and read-only in the card. */
    complexKeys?: string[];
    /** True if the source started with a valid `---\n...\n---\n` block. */
    hasFrontmatter: boolean;
}

const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/;

const stripQuotes = (s: string): string => {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
        return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
        return t.slice(1, -1).replace(/''/g, "'");
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
    const items: string[] = [];
    let cur = "";
    let quote: '"' | "'" | null = null;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (quote) {
            if (ch === "\\" && quote === '"' && i + 1 < inner.length) {
                cur += ch + inner[i + 1];
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            cur += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            cur += ch;
        } else if (ch === ",") {
            items.push(stripQuotes(cur.trim()));
            cur = "";
        } else {
            cur += ch;
        }
    }
    if (cur.trim() || items.length > 0) items.push(stripQuotes(cur.trim()));
    return items.filter((s) => s.length > 0);
};

function looksLikeYamlFrontmatter(yaml: string): boolean {
    let sawKey = false;
    for (const line of yaml.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (/^[A-Za-z0-9_.-]+\s*:/.test(line)) { sawKey = true; continue; }
        if (/^\s+/.test(line) || trimmed.startsWith("- ")) continue;
        return false;
    }
    return sawKey;
}

export function parseFrontmatter(source: string): FrontmatterResult {
    const match = source.match(FM_REGEX);
    if (!match || !looksLikeYamlFrontmatter(match[1])) {
        return { body: source, data: {}, hasFrontmatter: false };
    }

    const yaml = match[1];
    const body = source.slice(match[0].length);
    const data: Record<string, string | number | boolean | string[]> = {};
    const complexKeys: string[] = [];

    const lines = yaml.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            i++;
            continue;
        }
        if (/^\s+/.test(line)) {
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

        // Multiline block scalars (> or |): preserve verbatim and mark read-only.
        if (value === "|" || value === ">" || value === "|-" || value === ">-") {
            const parts: string[] = [];
            let j = i + 1;
            while (j < lines.length && (/^\s+/.test(lines[j]) || lines[j].trim() === "")) {
                if (lines[j].trim() !== "") parts.push(lines[j].trim());
                j++;
            }
            data[key] = parts.join(" ");
            complexKeys.push(key);
            i = j;
            continue;
        }

        // Inline array: tags: [a, b, c]
        if (value.startsWith("[") && value.endsWith("]")) {
            data[key] = parseInlineArray(value);
            i++;
            continue;
        }

        // Block array or nested map: scan indented lines beneath `key:`
        if (value === "") {
            const items: string[] = [];
            let nested = false;
            let j = i + 1;
            while (j < lines.length) {
                const next = lines[j];
                const ntrim = next.trim();
                if (!ntrim) { j++; continue; }
                if (ntrim.startsWith("#")) { nested = true; j++; continue; }
                if (/^\s*-\s*/.test(next)) {
                    items.push(stripQuotes(ntrim.replace(/^-\s*/, "")));
                    j++;
                } else if (/^\s+/.test(next)) {
                    nested = true;
                    j++;
                } else {
                    break;
                }
            }
            if (nested) {
                data[key] = items.length > 0 ? items : "";
                complexKeys.push(key);
                i = j;
                continue;
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

    return { body, data, complexKeys, hasFrontmatter: true };
}

const formatScalar = (v: string | number | boolean, inArray = false): string => {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
    if (
        /^(true|false|-?\d+(\.\d+)?)$/.test(v) ||
        /[:#&*!|>'"]/.test(v) ||
        v.includes("\n") ||
        (inArray && /[,\[\]]/.test(v))
    ) {
        return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return v;
};

const formatValue = (v: FrontmatterValue): string => {
    if (Array.isArray(v)) {
        return `[${v.map((s) => formatScalar(s, true)).join(", ")}]`;
    }
    return formatScalar(v);
};

/**
 * Lossless update of a single frontmatter key inside `source`, preserving all
 * comments, formatting, nested maps, and multiline values elsewhere in the YAML
 * block. Falls back to appending cleanly or serializing if absent.
 */
export function updateFrontmatterKey(source: string, key: string, value: FrontmatterValue): string {
    const match = source.match(FM_REGEX);
    if (!match) return serializeFrontmatter({ [key]: value }, source);
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const fullHeader = match[0];
    const rest = source.slice(fullHeader.length);
    const closingMatch = fullHeader.match(/\r?\n(---|\.\.\.)(?:\r?\n)?$/);
    const closer = closingMatch?.[1] ?? "---";
    const lines = match[1].split(/\r?\n/);

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && !/^\s+/.test(line)) {
            const colonIdx = trimmed.indexOf(":");
            if (colonIdx !== -1 && trimmed.slice(0, colonIdx).trim() === key) {
                let end = i + 1;
                while (end < lines.length) {
                    const next = lines[end];
                    const ntrim = next.trim();
                    if (!ntrim || ntrim.startsWith("#") || /^\s+/.test(next) || /^\s*-\s*/.test(next)) {
                        end++;
                    } else {
                        break;
                    }
                }
                const replacementLine = `${key}: ${formatValue(value)}`;
                const updatedLines = [...lines.slice(0, i), replacementLine, ...lines.slice(end)];
                const tailEol = fullHeader.endsWith("\n") ? eol : "";
                return `---${eol}${updatedLines.join(eol)}${eol}${closer}${tailEol}${rest}`;
            }
        }
        i++;
    }

    const updatedLines = [...lines, `${key}: ${formatValue(value)}`];
    const tailEol = fullHeader.endsWith("\n") ? eol : "";
    return `---${eol}${updatedLines.join(eol)}${eol}${closer}${tailEol}${rest}`;
}

/** Serialize a parsed frontmatter map back into a `---` block + the body. */
export function serializeFrontmatter(data: Record<string, FrontmatterValue>, body: string): string {
    const lines = Object.entries(data).map(([k, v]) => `${k}: ${formatValue(v)}`);
    if (lines.length === 0) return body;
    return `---\n${lines.join("\n")}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}
