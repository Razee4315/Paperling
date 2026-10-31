import { pathKey } from "./tabsModel";

/** Every extension the app opens: Markdown under its common names, plain-text
 * notes, and HTML pages (shown rendered, see HtmlPreview). The Open dialog,
 * drops, the OS launch handoff (src-tauri/src/lib.rs) and the explorer
 * (is_note_file) share this list; `.mdown`, `.mkd` and `.mdx` used to be
 * refused everywhere. FILES-10. */
export const DOCUMENT_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mdx", "txt", "text", "html", "htm"] as const;

const DOCUMENT_PATH_RE = new RegExp(`\\.(${DOCUMENT_EXTENSIONS.join("|")})$`, "i");

/** Shared native and browser drop filter, including plain-text notes. */
export const isDocumentPath = (path: string): boolean => DOCUMENT_PATH_RE.test(path);

/** HTML pages get the rendered page view instead of the Markdown preview. #295. */
export const isHtmlPath = (path: string | null | undefined): boolean => !!path && /\.html?$/i.test(path);

/**
 * Reject paths that would escape the document's directory or name an absolute
 * location. The capabilities allow `**` reads, so we have to enforce the
 * boundary in code: a malicious .md must not be able to use
 * `![pwn](../../../etc/passwd)` to peek at arbitrary files.
 */
export function isUnsafeRelativePath(p: string): boolean {
    if (!p) return true;
    if (/\0/.test(p)) return true;
    // Absolute paths: leading slash, leading backslash, or drive letter.
    if (/^([a-zA-Z]:|\/|\\)/.test(p)) return true;
    // Any segment that is exactly `..` (handles foo/../etc, ../etc, etc.).
    const segments = p.split(/[/\\]+/);
    return segments.some((seg) => seg === "..");
}

/** FILES-09 (#227): preserve the filesystem root when walking up one level.
 * '/home' belongs to '/', and 'C:/child' belongs to 'C:/', not drive-relative C:. */
export function parentDirectory(path: string | null): string | null {
    if (!path) return null;
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized || /^[a-z]:$/i.test(normalized)) return null;
    const slash = normalized.lastIndexOf("/");
    if (slash === 0) return "/";
    if (slash === 2 && /^[a-z]:\//i.test(normalized)) return normalized.slice(0, 3);
    return slash > 0 ? normalized.slice(0, slash) : null;
}

export const isPathWithin = (path: string, root: string): boolean => {
    const clean = (p: string) => pathKey(p).replace(/\/+$/, "");
    return clean(path) === clean(root) || clean(path).startsWith(clean(root) + "/");
};
