import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UseAutosaveOptions {
  /** Master toggle (Settings → Editor). */
  enabled: boolean;
  /** Path of the open file, or null for an unsaved Untitled buffer. */
  filePath: string | null;
  /** Live editor content. */
  content: string;
  /** Last-persisted content; autosave is a no-op while it equals `content`. */
  originalContent: string;
  /**
   * True while an AI review is pending. `content` then reflects only the chunks
   * accepted so far, and a later "Reject all" would otherwise leave disk holding
   * edits the user explicitly rejected, so autosave must stay parked. AI-01.
   */
  isReviewActive: boolean;
  /**
   * True while a disk-conflict dialog is pending (the file changed on disk under
   * a dirty buffer). Autosaving would answer the dialog's question by silently
   * overwriting the external changes, so autosave stays parked until the user
   * picks a side. EXT-02.
   */
  conflictPending: boolean;
  /** Called after a successful write with the new mtime and the saved content. */
  onSaved: (mtime: number, content: string) => void;
  /** Called when a write fails (already throttled to at most once per 30s). */
  onError: (message: string) => void;
}

/** Debounce before persisting after the last edit. */
const AUTOSAVE_DELAY_MS = 1500;
/** Don't surface autosave failures more than once per this window. */
const ERROR_THROTTLE_MS = 30_000;

/**
 * Autosave: once enabled, persist the buffer a moment after the user stops
 * typing. Silent on success (the status dot already flips to "Saved"); failures
 * surface through `onError`, throttled so a broken disk keeps reminding the user
 * without spamming on every debounce tick. A successful save clears the throttle.
 *
 * `onSaved`/`onError` must be stable (wrap in useCallback) — they're effect deps,
 * so a fresh identity each render would reset the debounce timer continuously and
 * autosave would never fire.
 */
export function useAutosave({
  enabled,
  filePath,
  content,
  originalContent,
  isReviewActive,
  conflictPending,
  onSaved,
  onError,
}: UseAutosaveOptions): void {
  const lastErrorRef = useRef(0);

  useEffect(() => {
    if (!enabled || !filePath || content === originalContent || isReviewActive || conflictPending) return;
    const id = window.setTimeout(async () => {
      try {
        const mtime = await invoke<number>("save_file", { path: filePath, content });
        onSaved(mtime, content);
        lastErrorRef.current = 0;
      } catch (err) {
        const now = Date.now();
        if (now - lastErrorRef.current > ERROR_THROTTLE_MS) {
          lastErrorRef.current = now;
          const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
          onError(msg || "Autosave failed");
        }
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [enabled, filePath, content, originalContent, isReviewActive, conflictPending, onSaved, onError]);
}
