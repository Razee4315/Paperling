import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribeExternalChecks, type ExternalCheckTrigger } from "../utils/externalCheck";
import { decideDiskChange } from "../utils/diskGuard";
import { idleWriteToken, readTextFile } from "../utils/fileIO";

export interface UseExternalChangeWatcherOptions {
  /** Path of the open file, or null. Read live via ref (listener mounts once). */
  filePathRef: RefObject<string | null>;
  /** Live editor content. */
  contentRef: RefObject<string>;
  /** Last-persisted content. */
  originalContentRef: RefObject<string>;
  /** Known on-disk mtime (ms). Updated in place when a newer mtime is seen. */
  knownMtimeRef: RefObject<number>;
  /** True while an AI review is pending — don't reload over a proposed diff. */
  isReviewActiveRef: RefObject<boolean>;
  /**
   * Reload the file from disk (used when the buffer is clean). Resolves false
   * when it declined because the buffer was edited during the read; the
   * change is then treated as a conflict. EXT-09.
   */
  reload: (path: string) => Promise<boolean | void>;
  /** Called after a silent reload of a clean buffer, with what triggered it. */
  onReloaded: (trigger: ExternalCheckTrigger) => void;
  /** Called when the file changed on disk but the buffer is dirty. */
  onConflict: () => void;
}

/**
 * Detect the open file changing underneath us (sync tools, another editor). On
 * window focus, and on an interval while the window is visible (EXT-07), stat
 * the file: if it's newer than what we last wrote and the
 * buffer is clean, reload silently; if the buffer is dirty, warn that saving will
 * overwrite. EXT-01.
 *
 * `reload`/`onReloaded`/`onConflict` should be stable (useCallback); everything
 * else is read through refs so the focus listener mounts once.
 */
export function useExternalChangeWatcher({
  filePathRef,
  contentRef,
  originalContentRef,
  knownMtimeRef,
  isReviewActiveRef,
  reload,
  onReloaded,
  onConflict,
}: UseExternalChangeWatcherOptions): void {
  useEffect(() => {
    let checking = false;
    const checkExternalChange = async (trigger: ExternalCheckTrigger) => {
      const path = filePathRef.current;
      // Bail before claiming the `checking` slot so an early return can never
      // strand it set (that would silently kill detection for the session).
      if (!path || checking || isReviewActiveRef.current) return;
      // One of our own saves overlapping the stat would read as an external
      // change; skip this tick, the next one sees the recorded mtime. EXT-08.
      const writeToken = idleWriteToken();
      if (writeToken === null) return;
      checking = true;
      try {
        const known = knownMtimeRef.current ?? 0;
        const info = await invoke<{ modified: number }>("get_file_info", { path });
        if (idleWriteToken() !== writeToken) return;
        // The user switched documents during the stat, so this result belongs
        // to a tab that is no longer live. Comparing it against the new tab's
        // mtime made a newer file look changed: reload(path) dragged the user
        // back and replaced that tab's unsaved text with the disk version, and
        // a dirty new tab got a false conflict. The 1.5 s interval (EXT-07)
        // made this a routine race. The next tick checks the live file. EXT-11.
        if (filePathRef.current !== path || knownMtimeRef.current !== known) return;
        const decision = decideDiskChange(known, info?.modified ?? 0);
        if (decision.kind === "unchanged") return;
        // A file reporting NO mtime at all can't be re-anchored here — every
        // tick would re-read it. The pre-write guard (EXT-10) covers it at
        // save time, so the watcher only handles a usable on-disk mtime.
        if (decision.kind === "compare" && !(info.modified > 0)) return;
        // Update first so a failed/declined reload doesn't re-toast forever.
        // Adopting a mtime that just came back usable also re-arms ordinary
        // mtime detection from now on. EXT-10.
        knownMtimeRef.current = info.modified;
        if (contentRef.current === originalContentRef.current) {
          if ((await reload(path)) === false) onConflict();
          else onReloaded(trigger);
        } else if (decision.kind === "changed") {
          onConflict();
        } else {
          // mtime couldn't decide (our baseline was unusable): the on-disk
          // mtime may simply have been missing all along, so confirm the
          // change by content before raising the dialog. The write would be
          // guarded anyway (EXT-10), but detecting at focus time matches how
          // every other external change is surfaced.
          const disk = await readTextFile<{ content: string }>(path).catch(() => null);
          if (filePathRef.current !== path) return; // Same switch as above. EXT-11.
          if (disk !== null && typeof disk.content === "string" && disk.content !== originalContentRef.current) {
            onConflict();
          }
        }
      } catch {
        /* file gone or stat failed — the save path will surface it */
      } finally {
        checking = false;
      }
    };
    return subscribeExternalChecks((trigger) => void checkExternalChange(trigger));
  }, [filePathRef, contentRef, originalContentRef, knownMtimeRef, isReviewActiveRef, reload, onReloaded, onConflict]);
}
