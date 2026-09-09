import { IS_MOBILE, initPlatformClass, isTauri } from "./platform";

/**
 * Pure helpers behind the mobile save-as flow. On the phone there is no OS
 * save panel that yields a std::fs-readable path (SAF returns URI-form
 * identifiers), so saving means: ask for a NAME, write into the app-private
 * notes directory. These functions normalize that name and build the target
 * path so the flow is unit-testable without a device.
 */

/** Characters Android forbids in file names (the FAT-family blacklist). */
const ILLEGAL_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Turn free user input into a safe markdown file name.
 * - strips illegal characters (replaced with `-`, runs collapsed)
 * - trims whitespace, leading/trailing dots and dashes (Windows-style
 *   trailing-dot hazards, and a name of only dots is not a file)
 * - guarantees the `.md` extension
 * - falls back to `Untitled.md` when nothing usable remains
 */
export function normalizeMarkdownFileName(raw: string): string {
    const cleaned = raw
        .replace(ILLEGAL_FILENAME, "-")
        .replace(/-+/g, "-")
        .trim()
        .replace(/^[.\-]+/, "")
        .replace(/[.\-]+$/, "")
        .trim();
    if (!cleaned) return "Untitled.md";
    // A dot between characters is a name, not an extension: "my.notes" stays,
    // only a MISSING extension gains ".md" (case-insensitive check).
    return /\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

/**
 * Join a notes directory and a normalized file name into the save target.
 * Uses `/` — Android app-data paths are POSIX, and the backend treats both
 * separators equivalently. Guards the obvious hazards anyway (the backend
 * re-validates; defense in depth).
 */
export function joinNotesPath(notesDir: string, fileName: string): string | null {
    const name = normalizeMarkdownFileName(fileName);
    const dir = (notesDir || "").trim();
    if (!dir) return null;
    const sep = dir.endsWith("/") ? "" : "/";
    return `${dir}${sep}${name}`;
}

/** Whether this session should offer the mobile save-as modal instead of the OS dialog. */
export function useMobileSaveFlow(): boolean {
    return isTauri() && IS_MOBILE;
}

// Re-exported so tests and App.tsx share one import site.
export { IS_MOBILE, initPlatformClass, isTauri };
