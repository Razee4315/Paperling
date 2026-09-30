import { pathKey } from "./tabsModel";

/** Shared native and browser drop filter, including plain-text notes. */
export const isDocumentPath = (path: string): boolean => /\.(md|markdown|txt|text)$/i.test(path);

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
