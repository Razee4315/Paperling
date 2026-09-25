/**
 * Pure data model for the open-file tabs. The heavy state lives in App (the
 * "active" tab is the live editor); these helpers just manage the list so the
 * tricky bits (which tab to focus after a close) are unit-testable.
 */

export interface TabState {
  /** Stable id for the lifetime of the tab (unrelated to the file path). */
  id: string;
  /** null for an unsaved "Untitled" buffer. */
  filePath: string | null;
  fileName: string;
  content: string;
  originalContent: string;
  fileSize: number;
  /** Last-known on-disk mtime (ms), for external-change detection. */
  knownMtime: number;
  /** 1-based caret/top-visible line when last active, to restore your place on
   *  switch-back. Undefined for a never-yet-focused tab. */
  cursorLine?: number;
}

/** A tab is dirty when its buffer differs from what's on disk. */
export function isTabDirty(tab: Pick<TabState, "content" | "originalContent">): boolean {
  return tab.content !== tab.originalContent;
}

/** The live editor buffer for the ACTIVE tab. Its stored snapshot in the tabs
 *  array lags until the next switch, so dirty checks for the active tab must
 *  read these live values instead. `fileName` may be null for an Untitled buffer. */
export interface LiveActiveTab {
  filePath: string | null;
  fileName: string | null;
  content: string;
  originalContent: string;
}

/** A tab that has unsaved changes, in the shape the window-close save loop needs. */
export interface DirtyTab {
  id: string;
  filePath: string | null;
  fileName: string;
  content: string;
}

/**
 * Every open tab with unsaved changes. The ACTIVE tab is read from `live` (the
 * editor's current buffer) rather than its stored snapshot, which lags until the
 * next tab switch; every other tab is compared against its own saved
 * originalContent. This is what the window-close guard uses so a dirty
 * BACKGROUND tab can't be discarded silently when the active tab is clean.
 * TABS-04 / issue #88.
 */
export function collectDirtyTabs(
  tabs: TabState[],
  activeId: string | null,
  live: LiveActiveTab
): DirtyTab[] {
  const dirty: DirtyTab[] = [];
  for (const t of tabs) {
    const isActive = t.id === activeId;
    const content = isActive ? live.content : t.content;
    const originalContent = isActive ? live.originalContent : t.originalContent;
    if (!isTabDirty({ content, originalContent })) continue;
    dirty.push({
      id: t.id,
      filePath: isActive ? live.filePath : t.filePath,
      fileName: isActive ? (live.fileName ?? "Untitled.md") : t.fileName,
      content,
    });
  }
  return dirty;
}

/**
 * A crash-recovery snapshot of one dirty buffer (HOT-01): enough to re-open
 * the buffer with its unsaved edits after a force-quit, crash, or OS reboot —
 * the things the regular session (paths + caret lines only) can't cover.
 */
export interface BufferBackupEntry {
  /** Absolute path for a saved file, null for an untitled buffer. */
  filePath: string | null;
  fileName: string;
  content: string;
  originalContent: string;
  cursorLine?: number;
}

/**
 * Crash-recovery snapshots for every dirty tab. Same active-tab-vs-snapshot
 * rule as collectDirtyTabs (TABS-04); clean tabs are skipped — the file on
 * disk already holds their state.
 */
export function collectBufferBackups(
  tabs: TabState[],
  activeId: string | null,
  live: LiveActiveTab,
  activeCursorLine?: number
): BufferBackupEntry[] {
  const backups: BufferBackupEntry[] = [];
  for (const t of tabs) {
    const isActive = t.id === activeId;
    const content = isActive ? live.content : t.content;
    const originalContent = isActive ? live.originalContent : t.originalContent;
    if (!isTabDirty({ content, originalContent })) continue;
    backups.push({
      filePath: isActive ? live.filePath : t.filePath,
      fileName: isActive ? (live.fileName ?? "Untitled.md") : t.fileName,
      content,
      originalContent,
      cursorLine: isActive ? activeCursorLine : t.cursorLine,
    });
  }
  return backups;
}

/**
 * Comparison key for a file path. The same file reaches the app spelled
 * differently — dialog paths use `\`, wikilink/relative resolution may use
 * `/`, and Windows paths are case-insensitive — and an exact string compare
 * opened it in two tabs whose saves clobbered each other. Drive-letter and
 * UNC paths are Windows paths, so only those are case-folded. TABS-18.
 */
export function pathKey(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const isWindows = /^[a-zA-Z]:\//.test(slashed) || slashed.startsWith("//");
  return isWindows ? slashed.toLowerCase() : slashed;
}

/** Do two (possibly null) paths name the same file? Null never matches. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && pathKey(a) === pathKey(b);
}

/** Find an open tab by file path (null paths never match). */
export function findTabByPath(tabs: TabState[], path: string | null): TabState | undefined {
  if (path == null) return undefined;
  return tabs.find((t) => samePath(t.filePath, path));
}

/**
 * Which tab should become active after `closingId` is closed: the tab to the
 * right (the one that slides into the closed slot), else the tab to the left,
 * else null when nothing remains. Mirrors common editor behaviour.
 */
export function nextActiveAfterClose(tabs: TabState[], closingId: string): string | null {
  const idx = tabs.findIndex((t) => t.id === closingId);
  if (idx === -1) return null;
  const remaining = tabs.filter((t) => t.id !== closingId);
  if (remaining.length === 0) return null;
  return (remaining[idx] ?? remaining[idx - 1] ?? remaining[remaining.length - 1]).id;
}

/**
 * The name for a new Untitled buffer, numbered so repeated Ctrl+N don't all read
 * "Untitled.md". Returns the lowest "Untitled-N.md" not currently in use by an
 * unsaved tab (N starts at 1). TABS-08.
 */
export function nextUntitledName(tabs: TabState[]): string {
  const used = new Set(
    tabs.filter((t) => t.filePath === null).map((t) => t.fileName)
  );
  for (let n = 1; ; n++) {
    const candidate = `Untitled-${n}.md`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * An existing untitled buffer that is empty and pristine (no path, no content) —
 * worth reusing on "New file" instead of stacking another identical blank tab.
 * TABS-08.
 */
export function findReusableUntitledTab(tabs: TabState[]): TabState | undefined {
  return tabs.find((t) => t.filePath === null && t.content === "" && t.originalContent === "");
}

/** Folder segments of a path in natural (root → parent) order. `a/b/c/x.md` →
 *  ["a","b","c"]. Handles both `/` and `\` separators. Null → []. */
function parentSegments(filePath: string | null): string[] {
  if (!filePath) return [];
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(0, -1); // drop the file name itself
}

/**
 * Display label per tab: just the file name when unique, else the file name plus
 * the shortest trailing folder path that distinguishes it from the other tabs
 * sharing that name — like `README.md — docs`. TABS-09.
 */
export function computeTabLabels(
  tabs: Array<{ id: string; fileName: string; filePath: string | null }>
): Map<string, string> {
  const labels = new Map<string, string>();
  const byName = new Map<string, typeof tabs>();
  for (const t of tabs) {
    const arr = byName.get(t.fileName) ?? [];
    arr.push(t);
    byName.set(t.fileName, arr);
  }
  for (const [name, group] of byName) {
    if (group.length === 1) {
      labels.set(group[0].id, name);
      continue;
    }
    const withSegs = group.map((t) => ({ id: t.id, segs: parentSegments(t.filePath) }));
    const maxDepth = Math.max(1, ...withSegs.map((g) => g.segs.length));
    for (const g of withSegs) {
      let suffix = "";
      for (let d = 1; d <= maxDepth; d++) {
        const mine = g.segs.slice(-d).join("/");
        const collision = withSegs.some((o) => o.id !== g.id && o.segs.slice(-d).join("/") === mine);
        suffix = mine;
        if (!collision) break;
      }
      labels.set(g.id, suffix ? `${name} — ${suffix}` : name);
    }
  }
  return labels;
}

/** Move a tab from one index to another, returning a new array. Out-of-range or
 *  no-op moves return the original array unchanged. Used for drag-reorder. TABS-10. */
export function moveTab(tabs: TabState[], fromIndex: number, toIndex: number): TabState[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 || fromIndex >= tabs.length ||
    toIndex < 0 || toIndex >= tabs.length
  ) {
    return tabs;
  }
  const copy = tabs.slice();
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}
