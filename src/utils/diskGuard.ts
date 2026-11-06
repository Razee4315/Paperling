/**
 * Pre-write disk-change decisions for files whose mtime can't be trusted.
 *
 * The external-change guards (EXT-06) compare the on-disk mtime against the
 * mtime the buffer last read or wrote. Both values come from the backend's
 * mtime, which is 0 when the OS reports a pre-epoch timestamp or the stat
 * fails outright (some FAT/network filesystems, clock resets). A 0 on either
 * side makes the comparison meaningless — and treating "can't compare" as
 * "unchanged" let autosave silently overwrite external edits with no conflict
 * dialog: the exact outcome the guard exists to prevent. EXT-10.
 *
 * When mtime can't decide, callers fall back to comparing the file's current
 * content with what the buffer believes is on disk (`originalContent`):
 * identical → nothing changed → safe to write; different → raise the conflict
 * dialog instead of overwriting. That keeps every write path guarded even on
 * filesystems that never report a usable mtime.
 */

export type DiskChangeDecision =
    /** mtime proves the disk file is unchanged — safe to write. */
    | { kind: "unchanged" }
    /** mtime proves the disk file changed — raise the conflict with this mtime. */
    | { kind: "changed"; diskMtime: number }
    /** mtime is unusable on at least one side — decide by comparing content. */
    | { kind: "compare" };

export function decideDiskChange(knownMtime: number, diskMtime: number): DiskChangeDecision {
    if (knownMtime > 0 && diskMtime > 0) {
        return diskMtime > knownMtime ? { kind: "changed", diskMtime } : { kind: "unchanged" };
    }
    return { kind: "compare" };
}
