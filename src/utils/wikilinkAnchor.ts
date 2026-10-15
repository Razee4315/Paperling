/**
 * Obsidian-style wikilink anchors (NAV-09): `[[Note#Heading]]`,
 * `[[Note#^block-id]]` and same-note `[[#Heading]]`. The whole target used to
 * be treated as a file name, so clicking `[[Note#Section]]` offered to CREATE
 * "Note#Section.md".
 */

/** Split a wikilink target into its file part and optional anchor. */
export function splitWikilinkTarget(target: string): { file: string; anchor: string | null } {
    const hash = target.indexOf("#");
    if (hash === -1) return { file: target.trim(), anchor: null };
    const anchor = target.slice(hash + 1).trim();
    return { file: target.slice(0, hash).trim(), anchor: anchor || null };
}

/** Display label for a wikilink with no alias, the way Obsidian shows it. */
export function wikilinkLabel(target: string): string {
    const { file, anchor } = splitWikilinkTarget(target);
    if (!anchor) return file;
    // Block refs show just the note; a nested heading path shows its last step.
    if (anchor.startsWith("^")) return file || anchor;
    const heading = anchor.split("#").pop()!.trim();
    return file ? `${file} › ${heading}` : heading;
}

const normalizeHeading = (s: string) =>
    s
        .toLowerCase()
        .replace(/[*_`~[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();

/**
 * 1-based source line an anchor points at, or null. Headings match by text
 * (case/format-insensitive; `A#B` heading paths use the last step); `^id`
 * matches a line ending in ` ^id`. Lines inside code fences are ignored.
 */
export function findAnchorLine(content: string, anchor: string): number | null {
    const lines = content.split("\n");
    if (anchor.startsWith("^")) {
        const id = anchor.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(^|\\s)\\^${id}\\s*$`);
        const idx = lines.findIndex((line) => re.test(line));
        return idx === -1 ? null : idx + 1;
    }
    const wanted = normalizeHeading(anchor.split("#").pop() ?? anchor);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
        if (m && normalizeHeading(m[1]) === wanted) return i + 1;
    }
    return null;
}
