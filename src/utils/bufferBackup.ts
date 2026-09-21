/**
 * Crash-recovery persistence for unsaved buffers ("hot exit", HOT-01).
 *
 * The regular session persistence (persistence.ts) stores paths + caret lines
 * only — a crash, power loss, or OS-update reboot lost every unsaved edit.
 * This store mirrors the DIRTY buffers' full text into localStorage, debounced
 * off the tab state, and boot offers it back. Clean buffers are never stored:
 * the file on disk already holds their state, so a stale entry can't shadow
 * newer disk content.
 *
 * localStorage keeps this self-contained (no Tauri dependency, works in the
 * browser dev shell). Bounded: oversized buffers are skipped and the list is
 * capped, so a runaway document can't evict everything else.
 */

export interface BufferBackup {
  /** Absolute path for a saved file, null for an untitled buffer. */
  filePath: string | null;
  fileName: string;
  content: string;
  originalContent: string;
  cursorLine?: number;
}

const KEY = "paperling.buffer-backup.v1";
/** Cap on stored buffers — enough for heavy tab users, small on disk. */
const MAX_BUFFERS = 20;
/** Per-buffer cap (~1MB of text). Larger buffers are skipped, not truncated:
 *  half a document restored as if whole is worse than not restored. */
const MAX_BUFFER_CHARS = 1_000_000;

export function loadBufferBackups(): BufferBackup[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is BufferBackup =>
        b != null &&
        typeof b === "object" &&
        typeof b.fileName === "string" &&
        typeof b.content === "string" &&
        typeof b.originalContent === "string" &&
        (b.filePath === null || typeof b.filePath === "string"),
    );
  } catch {
    return [];
  }
}

export function saveBufferBackups(backups: BufferBackup[]): void {
  try {
    const usable = backups
      .filter((b) => b.content.length <= MAX_BUFFER_CHARS)
      .slice(0, MAX_BUFFERS);
    if (usable.length === 0) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(usable));
  } catch {
    // Quota exceeded (private mode, huge set) — backups are best-effort by
    // design; never let a backup failure break the app.
  }
}
