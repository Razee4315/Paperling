/**
 * Cache of local preview images as object URLs, keyed by document folder +
 * relative path and validated against the file's mtime.
 *
 * Without the cache, a doc that references the same image 50 times reads the
 * file 50 times and creates 50 independent ObjectURLs. The cache used to be
 * keyed by path alone, so an image rewritten on disk (a regenerated SVG
 * diagram, an edited screenshot) kept showing its first version until the app
 * restarted. Each lookup now stats the file first: a changed mtime revokes the
 * stale URL and reads the file again. IMG-04.
 *
 * LRU eviction at `cap` entries: the Map preserves insertion order, so a hit
 * is re-inserted (moved to the end) and the front is evicted when full.
 * Evicted URLs are revoked so the image data can be GC'd.
 */
export interface LocalImageCacheDeps {
    /** mtime (ms) of the file, or null when it can't be stat'ed. */
    stat: (path: string) => Promise<number | null>;
    /** Read the image through the validated backend command. */
    read: (baseDir: string, relPath: string) => Promise<ArrayBuffer>;
    createUrl: (blob: Blob) => string;
    revokeUrl: (url: string) => void;
    cap?: number;
}

/** Join a document folder and a validated relative path for a stat call. */
export function joinImagePath(baseDir: string, relPath: string): string {
    return `${baseDir.replace(/[/\\]+$/, "")}/${relPath}`;
}

export function createLocalImageCache({ stat, read, createUrl, revokeUrl, cap = 100 }: LocalImageCacheDeps) {
    const entries = new Map<string, { url: string; mtime: number | null }>();

    return async function getLocalImageUrl(baseDir: string, relPath: string, mimeType: string): Promise<string> {
        const key = `${baseDir}\u0000${relPath}`;
        const mtime = await stat(joinImagePath(baseDir, relPath));
        const hit = entries.get(key);
        if (hit !== undefined) {
            entries.delete(key);
            // Unknown mtime (stat failed) keeps the cached copy rather than
            // re-reading on every render; the read below surfaces real errors.
            if (mtime === null || hit.mtime === mtime) {
                entries.set(key, hit);
                return hit.url;
            }
            revokeUrl(hit.url);
        }
        const buf = await read(baseDir, relPath);
        const url = createUrl(new Blob([buf], { type: mimeType }));
        entries.set(key, { url, mtime });
        if (entries.size > cap) {
            const oldestKey = entries.keys().next().value;
            if (oldestKey !== undefined) {
                revokeUrl(entries.get(oldestKey)!.url);
                entries.delete(oldestKey);
            }
        }
        return url;
    };
}
