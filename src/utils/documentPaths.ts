import { pathKey } from "./tabsModel";

/** Every extension the app opens: Markdown under its common names, plus
 * plain-text notes. The Open dialog, drops, the OS launch handoff
 * (src-tauri/src/lib.rs) and the explorer (is_note_file) share this list;
 * `.mdown`, `.mkd` and `.mdx` used to be refused everywhere. FILES-10. */
export const DOCUMENT_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "mdx", "txt", "text"] as const;

const DOCUMENT_PATH_RE = new RegExp(`\\.(${DOCUMENT_EXTENSIONS.join("|")})$`, "i");

/** Shared native and browser drop filter, including plain-text notes. */
export const isDocumentPath = (path: string): boolean => DOCUMENT_PATH_RE.test(path);

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
