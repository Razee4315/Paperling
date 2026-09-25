/**
 * Where, and under what name, a never-saved note is offered in the Save
 * dialog. SAVE-05.
 *
 * Every new note used to be offered as "Untitled-1.md", in whatever folder
 * the OS dialog happened to remember. Typora, iA Writer and VS Code suggest a
 * name from the text itself; Obsidian creates notes inside the current
 * folder. Paperling now does both: the note's title (frontmatter `title:`,
 * else its first heading, else its first line) in the folder of the file
 * you worked in last.
 */

/** Characters Windows (the strictest target) forbids in file names. */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_NAME = 60;

/** Strip inline markdown so "**Big** [idea](x)" becomes "Big idea". */
function plainText(line: string): string {
    return line
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/(\*\*|__|\*|_|~~|==)/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
        .replace(/^\s*>\s?/, "")
        .trim();
}

function toFileName(title: string): string | null {
    let name = title.replace(INVALID_CHARS, " ").replace(/\s+/g, " ").trim();
    if (name.length > MAX_NAME) {
        const cut = name.slice(0, MAX_NAME);
        const space = cut.lastIndexOf(" ");
        name = (space > 20 ? cut.slice(0, space) : cut).trim();
    }
    // Trailing dots/spaces are silently dropped by Windows; leading dots make
    // a hidden file on macOS/Linux.
    name = name.replace(/[. ]+$/, "").replace(/^\.+/, "");
    if (!name || RESERVED_WINDOWS.test(name)) return null;
    return `${name}.md`;
}

/** Suggested file name for `content`, or `fallback` when there's no title. */
export function suggestFileName(content: string, fallback: string): string {
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    // YAML frontmatter: a `title:` wins; otherwise skip the block.
    if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
        if (end > 0) {
            for (let k = 1; k < end; k++) {
                const m = lines[k].match(/^title:\s*(.+?)\s*$/i);
                if (m) {
                    const name = toFileName(m[1].replace(/^["']|["']$/g, ""));
                    if (name) return name;
                }
            }
            i = end + 1;
        }
    }
    const rest = lines.slice(i, i + 40);
    let inFence = false;
    let firstText: string | null = null;
    for (const line of rest) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        const heading = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
        if (heading) {
            const name = toFileName(plainText(heading[1]));
            if (name) return name;
            continue;
        }
        if (firstText === null && line.trim()) firstText = plainText(line);
    }
    return (firstText && toFileName(firstText)) || fallback;
}

/** Folder of the most recently opened/saved file: where a new note most
 *  likely belongs. Null when there is no history yet. */
export function lastUsedDirectory(recent: { path: string; openedAt: number }[]): string | null {
    let best: { path: string; openedAt: number } | null = null;
    for (const f of recent) if (!best || f.openedAt > best.openedAt) best = f;
    return dirOf(best?.path);
}

/** Directory part of a path (either separator), or null for a bare name. */
export function dirOf(path: string | null | undefined): string | null {
    if (!path) return null;
    const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return i > 0 ? path.slice(0, i) : null;
}

/** Join a directory and a file name with the directory's own separator. */
export function joinPath(dir: string, name: string): string {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}
