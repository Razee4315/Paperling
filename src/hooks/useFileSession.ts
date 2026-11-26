import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { t } from "../i18n";
import { idleWriteToken, readTextFile, retargetEncodings, saveTextFile, type FileEncoding } from "../utils/fileIO";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { ViewMode } from "../components/ModeToggle";
import type { ToastType } from "./useToast";
import { useAutosave } from "./useAutosave";
import { useExternalChangeWatcher } from "./useExternalChangeWatcher";
import { subscribeExternalChecks, type ExternalCheckTrigger } from "../utils/externalCheck";
import { decideDiskChange } from "../utils/diskGuard";
import { IS_MOBILE } from "../utils/platform";
import { errMessage } from "../utils/errors";
import { parseDownloadsSentinel, saveToDownloads } from "../utils/nativePicker";
import { normalizeMarkdownFileName } from "../utils/mobileFiles";
import {
  addRecentFile,
  getLastFile,
  getOpenInReader,
  getReopenSession,
  getRecentFiles,
  getSession,
  setLastFile,
  setSession,
} from "../utils/persistence";
import {
  collectBufferBackups,
  collectDirtyTabs as computeDirtyTabs,
  findReusableUntitledTab,
  findTabByPath,
  samePath,
  pathKey,
  moveTab,
  nextActiveAfterClose,
  nextUntitledName,
  type DirtyTab,
  type TabState,
} from "../utils/tabsModel";
import { loadBufferBackups, saveBufferBackups } from "../utils/bufferBackup";
import { dirOf, joinPath, lastUsedDirectory, suggestFileName } from "../utils/saveName";
import { DOCUMENT_EXTENSIONS, isHtmlPath } from "../utils/documentPaths";

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
  /** Last-modified time (ms since epoch) — used to detect external edits. */
  modified: number;
  /** How the file is stored; fileIO keeps it for the save. ENC-03. */
  encoding?: FileEncoding;
}

type ShowToast = (message: string, type?: ToastType) => void;

export interface UseFileSessionOptions {
    currentLine: number;
    autoSaveEnabled: boolean;
    isReviewActive: boolean;
    clearReview: () => void;
    setMode: Dispatch<SetStateAction<ViewMode>>;
    showToast: ShowToast;
    /**
     * Where an untitled buffer should be saved. The desktop default opens the
     * OS save panel; mobile injects the in-app name prompt (SAF URIs from the
     * OS panel are unreadable by the Rust file commands). Resolves null on
     * cancel.
     */
    promptSavePath?: (defaultName: string | null, defaultDir?: string | null) => Promise<string | null>;
    /**
     * Called after a successful plain Save (Ctrl+S) of an already-saved file.
     * When provided it replaces the "File saved" toast: a toast over the text
     * on every habitual Ctrl+S was noise; the shell confirms in the status
     * bar instead. SAVE-07.
     */
    onSaved?: () => void;
    /** Tests can disable launch restoration without changing production behavior. */
    restoreOnMount?: boolean;
}

// The launch-file resolution must run exactly once per webview load. React
// StrictMode double-invokes effects in dev: without this guard the second run
// would find the CLI file already consumed (the backend take()s it) and start
// a racing last-session restore that can overwrite the just-opened file.
// Module-level on purpose — StrictMode remounts share module state.
let bootResolved = false;
/** Test-only: let a test run the once-per-load boot restore again. */
export function __resetBootForTests(): void {
  bootResolved = false;
}

export function useFileSession({
    currentLine,
    autoSaveEnabled,
    isReviewActive,
    clearReview,
    setMode,
    showToast,
    promptSavePath,
    onSaved,
    restoreOnMount = true,
}: UseFileSessionOptions) {
  // File state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContentState] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileSize, setFileSize] = useState(0);
  // Open-file tabs. The live state above is always the ACTIVE tab; `tabs` holds
  // the snapshots of every open file (incl. the active one). TABS-01.
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Bumped on every genuine document swap (tab switch, file open, new file) so
  // the editor can reset its undo history and Ctrl+Z can't reach into the
  // previously-shown document. See CodeEditor's docSwapId effect. TABS-03.
  const [docSwapId, setDocSwapId] = useState(0);
  // True while the launch-time file resolution (OS-opened CLI file, then
  // last-session restore) is still in flight. Shows a neutral splash instead
  // of flashing the WelcomeScreen for a frame. Whether a CLI file exists is
  // only known after asking the backend.
  const [booting, setBooting] = useState(restoreOnMount);
  const [isLoading, setIsLoading] = useState(false);
  // Pending dirty-tab close, awaiting the Save/Discard/Cancel dialog. TABS-05.
  const [closeTabPrompt, setCloseTabPrompt] = useState<{ id: string; fileName: string } | null>(null);
  // Pending disk-conflict choice: the open file changed on disk while the buffer
  // had unsaved edits, and we're awaiting Keep-mine / Load-from-disk. EXT-02.
  // `diskMtime` is the on-disk mtime that raised the conflict, when the
  // conflict came from a parked tab / pre-write check that did NOT absorb it
  // into knownMtime — "Keep mine" absorbs it so the same change can't re-raise
  // the dialog forever. EXT-04.
  const [conflictPrompt, setConflictPromptState] = useState<{ fileName: string; diskMtime?: number } | null>(null);
  // Synchronous mirror: snapshotActiveTab (called while leaving a tab, before
  // any re-render) must know whether the tab being left has an open conflict.
  const conflictPromptRef = useRef(conflictPrompt);
  const conflictPendingRef = useRef(conflictPrompt != null);
  const setConflictPrompt = useCallback((next: { fileName: string; diskMtime?: number } | null) => {
    conflictPromptRef.current = next;
    conflictPendingRef.current = next != null;
    setConflictPromptState(next);
  }, []);

  // === Tabs (snapshot-swap) ===
  // The live state (filePath/content/…) IS the active tab. `tabsRef`/`liveRef`
  // mirror state synchronously so the open/switch/close helpers can read and
  // commit without waiting for a re-render. We snapshot the active tab before
  // leaving it and restore the target's snapshot into the live state — so every
  // single-file system (autosave, AI review, external-change) is untouched. TABS-01.
  const tabSeqRef = useRef(0);
  const tabsRef = useRef<TabState[]>([]);
  tabsRef.current = tabs;
  // HOT-08: records not yet published as tabs must survive interim backup
  // writes while the active-first launch is still reading background notes.
  const pendingBootBackupsRef = useRef<ReturnType<typeof loadBufferBackups>>([]);
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;
  // Stack of recently-closed tabs (path + caret line) for Ctrl+Shift+T. Only
  // saved files are recoverable; untitled buffers aren't pushed. TABS-15.
  const closedTabsRef = useRef<{ path: string; cursorLine?: number }[]>([]);
  const liveRef = useRef({ filePath, fileName, content, originalContent, fileSize });
  // The line we'd return to when this file is re-activated: the caret line while
  // editing, or the top-visible line in reader mode. TABS-02.
  const currentLineRef = useRef(1);
  currentLineRef.current = currentLine;
  // Known on-disk modified time (ms). Compared against a fresh stat on window
  // focus to detect the file changing under us (sync tools, other editors).
  const knownMtimeRef = useRef(0);
  // Paths whose background autosave is parked because the file changed on disk
  // under a dirty buffer (keyed by pathKey(path) for Windows case-folding). EXT-03.
  const parkedAutosavePathsRef = useRef<Map<string, number>>(new Map());
  // One-shot "keep mine" records for files whose mtime never comes back usable
  // (EXT-10): after the user resolves a content-compared conflict with
  // "keep mine", the next write to that path is granted without re-asking.
  const keepMineMtimelessRef = useRef<Set<string>>(new Set());
  // Latest content + originalContent + filePath are kept synchronously in refs
  // via `commitLive` and `setContent` so rapid same-tick actions never read
  // pre-render values (TABS-21).
  const contentRef = useRef(content);
  const originalContentRef = useRef(originalContent);
  const filePathRef = useRef(filePath);
  // Whether an AI review is pending, mirrored into a ref for the focus-time
  // external-change watcher (registered once, so it can't read state directly).
  // AI-01.
  const reviewActiveRef = useRef(isReviewActive);
  reviewActiveRef.current = isReviewActive;

  // Synchronous setter + batch commit for live buffer fields (TABS-21).
  const setContent: Dispatch<SetStateAction<string>> = useCallback((action) => {
    const prev = contentRef.current;
    const next = typeof action === "function" ? action(prev) : action;
    liveRef.current = { ...liveRef.current, content: next };
    contentRef.current = next;
    setContentState(next);
  }, []);

  const commitLive = useCallback((patch: Partial<{
    filePath: string | null;
    fileName: string | null;
    content: string;
    originalContent: string;
    fileSize: number;
    knownMtime: number;
  }>) => {
    const prev = liveRef.current;
    const next = {
      filePath: patch.filePath !== undefined ? patch.filePath : prev.filePath,
      fileName: patch.fileName !== undefined ? patch.fileName : prev.fileName,
      content: patch.content !== undefined ? patch.content : prev.content,
      originalContent: patch.originalContent !== undefined ? patch.originalContent : prev.originalContent,
      fileSize: patch.fileSize !== undefined ? patch.fileSize : prev.fileSize,
    };
    liveRef.current = next;
    filePathRef.current = next.filePath;
    contentRef.current = next.content;
    originalContentRef.current = next.originalContent;
    if (patch.knownMtime !== undefined) knownMtimeRef.current = patch.knownMtime;
    if (patch.filePath !== undefined) setFilePath(patch.filePath);
    if (patch.fileName !== undefined) setFileName(patch.fileName);
    if (patch.content !== undefined) setContentState(patch.content);
    if (patch.originalContent !== undefined) setOriginalContent(patch.originalContent);
    if (patch.fileSize !== undefined) setFileSize(patch.fileSize);
  }, []);

  // Derived state
  const isDirty = content !== originalContent;
  // "Has a buffer" — true once a file is opened OR a blank Untitled buffer is started.
  const hasFile = filePath !== null || fileName !== null;

  const bumpDocSwap = useCallback(() => setDocSwapId((n) => n + 1), []);
  const commitTabs = useCallback((next: TabState[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);
  const setActiveTab = useCallback((id: string | null) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);
  const newTabId = useCallback(() => `tab-${++tabSeqRef.current}`, []);

  // Every open tab that has unsaved changes, reading the ACTIVE tab from live
  // state (its stored snapshot lags until the next switch) and the rest from
  // their snapshots. Used by the window-close guard so background tabs can't be
  // discarded silently. The dirty-collection logic itself is a pure helper so it
  // stays unit-testable; this wrapper just feeds it the current refs. TABS-04.
  const collectDirtyTabs = useCallback(
    (): DirtyTab[] => computeDirtyTabs(tabsRef.current, activeTabIdRef.current, liveRef.current),
    [],
  );

  // True while the background-autosave guard has parked this path because the
  // file changed on disk under a dirty buffer. The window-close "Save all"
  // consults this so it can't write (or silently discard) a conflicted buffer.
  // EXT-03.
  const isAutosaveParked = useCallback(
    (path: string | null | undefined): boolean => !!path && parkedAutosavePathsRef.current.has(pathKey(path)),
    [],
  );

  // Write the live editor state back into the active tab's entry.
  const snapshotActiveTab = useCallback(() => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const live = liveRef.current;
    // Leaving a tab while its disk-conflict dialog is open must NOT count as
    // "keep mine": park it under pathKey instead so switching back re-raises it. EXT-04.
    const pending = conflictPromptRef.current;
    if (pending && live.filePath && live.content !== live.originalContent) {
      parkedAutosavePathsRef.current.set(pathKey(live.filePath), pending.diskMtime ?? knownMtimeRef.current);
    }
    commitTabs(
      tabsRef.current.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filePath: live.filePath,
              fileName: live.fileName ?? "Untitled.md",
              content: live.content,
              originalContent: live.originalContent,
              fileSize: live.fileSize,
              knownMtime: knownMtimeRef.current,
              cursorLine: currentLineRef.current,
            }
          : tab,
      ),
    );
  }, [commitTabs]);

  // Load a tab's stored snapshot into the live editor state.
  const applyTabToLive = useCallback(
    (tab: TabState) => {
      clearReview();
      setConflictPrompt(null);
      bumpDocSwap();
      commitLive({
        filePath: tab.filePath,
        fileName: tab.fileName,
        content: tab.content,
        originalContent: tab.originalContent,
        fileSize: tab.fileSize,
        knownMtime: tab.knownMtime,
      });
      // A tab parked by the background-autosave guard has external changes the
      // user hasn't reviewed. Raising the conflict dialog here parks the
      // ACTIVE autosave (conflictPending) until Keep-mine / Load-from-disk. EXT-03.
      const parkedKey = tab.filePath ? pathKey(tab.filePath) : null;
      if (parkedKey && parkedAutosavePathsRef.current.has(parkedKey)) {
        setConflictPrompt({ fileName: tab.fileName, diskMtime: parkedAutosavePathsRef.current.get(parkedKey) });
      }
      if (tab.filePath) setLastFile(tab.filePath);
      const line = tab.cursorLine ?? 1;
      requestAnimationFrame(() => {
        if (line > 1) window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line, source: "tab-restore" } }));
        else window.dispatchEvent(new CustomEvent("paperling:scroll-top", { detail: { source: "tab-restore" } }));
      });
    },
    [bumpDocSwap, clearReview, commitLive, setConflictPrompt],
  );

  // Switch to an already-open tab, snapshotting the current one first.
  const activateTab = useCallback(
    (id: string) => {
      if (id === activeTabIdRef.current) return;
      snapshotActiveTab();
      const target = tabsRef.current.find((tab) => tab.id === id);
      if (!target) return;
      setActiveTab(id);
      applyTabToLive(target);
    },
    [applyTabToLive, setActiveTab, snapshotActiveTab],
  );

  // Switch to the previous / next tab (Alt+Left / Alt+Right), wrapping around.
  const cycleTab = useCallback(
    (delta: number) => {
      const list = tabsRef.current;
      if (list.length < 2) return;
      const index = list.findIndex((tab) => tab.id === activeTabIdRef.current);
      if (index === -1) return;
      activateTab(list[(index + delta + list.length) % list.length].id);
    },
    [activateTab],
  );

  // Load a file directly from disk into the tab model. Resolves false only
  // when `keepEdits` declined the load (see below), true otherwise.
  const loadFileDirect = useCallback(
    async (path: string, { keepEdits = false }: { keepEdits?: boolean } = {}): Promise<boolean> => {
      const outgoing = filePathRef.current;
      // Preserve the file we're leaving in its tab before overwriting live state.
      snapshotActiveTab();
      setIsLoading(true);
      try {
        const fileData = await readTextFile<FileData>(path);
        // The user left this file while the watcher's reload was reading it.
        // Applying the read would pull them back and overwrite the tab's
        // unsaved text. The tab refreshes through the background check. EXT-11.
        if (keepEdits && !samePath(filePathRef.current, path)) return true;
        // An external-change reload only starts on a clean buffer, but the
        // user can type while the file is being read; applying it would drop
        // those keystrokes. With the 1.5 s interval check (EXT-07) that is a
        // live race while someone types next to an agent editing the same
        // note. Decline, and let the caller raise the conflict dialog. EXT-09.
        if (keepEdits && samePath(filePathRef.current, path) && contentRef.current !== originalContentRef.current) {
          return false;
        }
        // A fresh load is a clean slate for every overlay: a review pending from
        // the PREVIOUS file must not survive into this one (its merge view would
        // diff old-file content against the new document, and its chunk buttons
        // would write the old file's proposed text here), a stale conflict
        // prompt must not keep this file's saves parked, and any background
        // parking for this path is moot — we just read the disk version.
        // EXT-02 / AI-02.
        clearReview();
        setConflictPrompt(null);
        parkedAutosavePathsRef.current.delete(pathKey(fileData.path));
        const prevLive = liveRef.current;
        bumpDocSwap();
        commitLive({
          filePath: fileData.path,
          fileName: fileData.name,
          content: fileData.content,
          originalContent: fileData.content,
          fileSize: fileData.size,
          knownMtime: fileData.modified ?? 0,
        });
        // Track recents + last-opened for restore-on-launch.
        addRecentFile(fileData.path, fileData.name);
        setLastFile(fileData.path);
        // Upsert the tab: reuse an existing tab for this path (e.g. a reload),
        // otherwise open a new one. Either way it becomes active. TABS-01.
        const loaded = {
          filePath: fileData.path,
          fileName: fileData.name,
          content: fileData.content,
          originalContent: fileData.content,
          fileSize: fileData.size,
          knownMtime: fileData.modified ?? 0,
        };
        const existing = findTabByPath(tabsRef.current, fileData.path);
        if (existing) {
          commitTabs(tabsRef.current.map((tab) => (tab.id === existing.id ? { ...tab, ...loaded } : tab)));
          setActiveTab(existing.id);
        } else {
          const id = newTabId();
          const activeIdx = tabsRef.current.findIndex((tab) => tab.id === activeTabIdRef.current);
          const active = activeIdx >= 0 ? tabsRef.current[activeIdx] : undefined;
          const pristine =
            active && !active.filePath && !prevLive.filePath && prevLive.content === "" && prevLive.originalContent === "";
          if (pristine) {
            const next = [...tabsRef.current];
            next[activeIdx] = { id, ...loaded };
            commitTabs(next);
          } else {
            commitTabs([...tabsRef.current, { id, ...loaded }]);
          }
          setActiveTab(id);
        }
        // Snap the new file to the top — but not on a same-path external reload,
        // which should keep the reader where they were. NAV-04.
        if (!samePath(outgoing, fileData.path)) {
          requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("paperling:scroll-top")));
        }
        if (!samePath(outgoing, fileData.path) && getOpenInReader()) setMode("preview");
      } catch (error) {
        console.error("Failed to load file:", error);
        // Surface the actual Rust error so size/not-found failures reach the user.
        showToast(errMessage(error) || t("toast.failedToOpenFile"), "error");
      } finally {
        setIsLoading(false);
      }
      return true;
    },
    [bumpDocSwap, clearReview, commitLive, commitTabs, newTabId, setActiveTab, setConflictPrompt, setMode, showToast, snapshotActiveTab],
  );

  // Open a file: if it's already in a tab, just switch to it (preserving any
  // unsaved edits there); otherwise load it into a new tab. With tabs there's no
  // need to prompt before opening — the current file stays open in its own tab.
  const loadFile = useCallback(
    async (path: string) => {
      const existing = findTabByPath(tabsRef.current, path);
      if (existing) {
        activateTab(existing.id);
        return;
      }
      await loadFileDirect(path);
    },
    [activateTab, loadFileDirect],
  );

  // Reopen the most recently closed (saved) tab, restoring its caret line. TABS-15.
  const reopenClosedTab = useCallback(async () => {
    const entry = closedTabsRef.current.pop();
    if (!entry) return;
    // Wait for the (async) read before jumping: a fixed 150ms timer lost the
    // race on slow disks and moved the caret in the PREVIOUS document. TABS-19.
    await loadFile(entry.path);
    if (entry.cursorLine && entry.cursorLine > 1) {
      const line = entry.cursorLine;
      requestAnimationFrame(() =>
        window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } })),
      );
    }
  }, [loadFile]);

  // Jump to a tab by position (Ctrl+1..8); index -1 means the last tab (Ctrl+9,
  // browser convention). TABS-16.
  const gotoTabByIndex = useCallback(
    (index: number) => {
      const list = tabsRef.current;
      if (list.length === 0) return;
      const target = index === -1 ? list[list.length - 1] : list[index];
      if (target) activateTab(target.id);
    },
    [activateTab],
  );

  // Remove a tab and refocus a neighbour (or fall back to the welcome screen).
  // No dirty check here — callers decide whether to prompt first. TABS-01.
  const finalizeCloseTab = useCallback(
    (id: string) => {
      // Remember saved tabs so Ctrl+Shift+T can reopen them. TABS-15.
      const closing = tabsRef.current.find((tab) => tab.id === id);
      if (closing?.filePath) {
        const isActiveClosing = id === activeTabIdRef.current;
        closedTabsRef.current.push({
          path: closing.filePath,
          cursorLine: isActiveClosing ? currentLineRef.current : closing.cursorLine,
        });
        if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      }
      const isActive = id === activeTabIdRef.current;
      const nextId = nextActiveAfterClose(tabsRef.current, id);
      const remaining = tabsRef.current.filter((tab) => tab.id !== id);
      commitTabs(remaining);
      if (!isActive) return;
      const target = nextId ? remaining.find((tab) => tab.id === nextId) : undefined;
      if (target) {
        setActiveTab(target.id);
        applyTabToLive(target);
      } else {
        // Last tab closed — return to the clean welcome state.
        setActiveTab(null);
        clearReview();
        setConflictPrompt(null);
        bumpDocSwap();
        commitLive({
          filePath: null,
          fileName: null,
          content: "",
          originalContent: "",
          fileSize: 0,
          knownMtime: 0,
        });
        setLastFile(null);
      }
    },
    [applyTabToLive, bumpDocSwap, clearReview, commitLive, commitTabs, setActiveTab, setConflictPrompt],
  );

  // Close a tab. A clean tab closes immediately; a dirty one opens the
  // Save / Discard / Cancel dialog (TABS-05).
  const closeTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === id);
      if (!tab) return;
      const isActive = id === activeTabIdRef.current;
      const dirty = isActive
        ? liveRef.current.content !== liveRef.current.originalContent
        : tab.content !== tab.originalContent;
      if (dirty) {
        setCloseTabPrompt({
          id,
          fileName: isActive ? (liveRef.current.fileName ?? "Untitled.md") : tab.fileName,
        });
        return;
      }
      finalizeCloseTab(id);
    },
    [finalizeCloseTab],
  );

  // Shared pre-write disk guard: returns null when safe to write, or the
  // on-disk mtime (0 when unavailable) that differs from what the tab read/wrote.
  // EXT-06 / EXT-10 / EXT-13.
  const diskChangedSince = useCallback(async (
    path: string,
    known = knownMtimeRef.current,
    original = originalContentRef.current,
  ): Promise<number | null> => {
    try {
      const info = await invoke<{ modified: number }>("get_file_info", { path });
      const decision = decideDiskChange(known, info?.modified ?? 0);
      if (decision.kind === "unchanged") return null;
      if (decision.kind === "changed") return decision.diskMtime;
      if (typeof original !== "string") return null;
      if (keepMineMtimelessRef.current.has(pathKey(path))) {
        keepMineMtimelessRef.current.delete(pathKey(path));
        return null;
      }
      const disk = await readTextFile<{ content: string }>(path, { recordHistory: false }).catch(() => null);
      if (disk === null || typeof disk.content !== "string") return null;
      return disk.content === original ? null : (info?.modified ?? 0);
    } catch {
      return null;
    }
  }, []);

  // The effective save target for a tab, reading the active tab from live state.
  const getTabSaveData = useCallback((id: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === id);
    if (!tab) return null;
    const isActive = id === activeTabIdRef.current;
    const live = liveRef.current;
    return {
      filePath: isActive ? live.filePath : tab.filePath,
      fileName: isActive ? (live.fileName ?? "Untitled.md") : tab.fileName,
      content: isActive ? live.content : tab.content,
      originalContent: isActive ? live.originalContent : tab.originalContent,
      knownMtime: isActive ? knownMtimeRef.current : tab.knownMtime,
    };
  }, []);

  const checkTabDiskChanged = useCallback(async (tabId: string): Promise<number | null> => {
    const data = getTabSaveData(tabId);
    if (!data?.filePath) return null;
    const newer = await diskChangedSince(data.filePath, data.knownMtime, data.originalContent);
    if (newer === null) return null;
    parkedAutosavePathsRef.current.set(pathKey(data.filePath), newer);
    if (tabId === activeTabIdRef.current) {
      setConflictPrompt({ fileName: data.fileName, diskMtime: newer });
    }
    return newer;
  }, [diskChangedSince, getTabSaveData, setConflictPrompt]);

  const markTabSaved = useCallback((tabId: string, savedPath: string, savedContent: string, mtime: number) => {
    const name = savedPath.replace(/\\/g, "/").split("/").pop() || "Untitled";
    parkedAutosavePathsRef.current.delete(pathKey(savedPath));
    commitTabs(
      tabsRef.current.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              filePath: savedPath,
              fileName: name,
              originalContent: savedContent,
              knownMtime: mtime,
            }
          : tab,
      ),
    );
    if (tabId === activeTabIdRef.current) {
      commitLive({
        filePath: savedPath,
        fileName: name,
        originalContent: savedContent,
        knownMtime: mtime,
      });
      setLastFile(savedPath);
    }
    addRecentFile(savedPath, name);
  }, [commitLive, commitTabs]);

  // Ask where an untitled buffer should live: the injected strategy when the
  // shell provides one (mobile name prompt), otherwise the OS save panel.
  const promptForPath = useCallback(
    (defaultName: string | null, defaultDir?: string | null): Promise<string | null> => {
      if (promptSavePath) return promptSavePath(defaultName, defaultDir);
      return save({
        // An HTML page keeps its type: a Markdown-only filter made Save As of
        // page.html offer page.html.md. #295.
        filters: isHtmlPath(defaultName)
          ? [{ name: "HTML", extensions: ["html", "htm"] }]
          : [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: defaultName && defaultDir ? joinPath(defaultDir, defaultName) : defaultName ?? undefined,
      }).then((selected) => (typeof selected === "string" ? selected : null));
    },
    [promptSavePath],
  );

  // The Save-As prompt resolves the Downloads sentinel when the user picked
  // "Save to Downloads" in the mobile modal. This hook owns the buffer
  // content, so the native MediaStore write happens here; the bridge mirrors
  // the file into the app cache and returns that path, which then behaves
  // like any other saved location (tabs, recents, autosave).
  const saveViaDownloads = useCallback(
    async (name: string, data: string): Promise<string | null> => {
      const result = await saveToDownloads(normalizeMarkdownFileName(name), data);
      if (!result.ok || !result.path) {
        showToast(result.error || t("toast.couldNotSaveToDownloads"), "error");
        return null;
      }
      return result.path;
    },
    [showToast],
  );

  // "Save" in the close-tab dialog: persist the tab (prompting a location for an
  // untitled buffer), then close it. Cancel/failure keeps the tab open. TABS-05.
  const handleSaveCloseTab = useCallback(async () => {
    const prompt = closeTabPrompt;
    if (!prompt) return;
    const data = getTabSaveData(prompt.id);
    if (!data) {
      setCloseTabPrompt(null);
      return;
    }
    // A conflicted buffer (parked background tab, or the active tab with the
    // conflict dialog up) must not be written from here either: "Save" would
    // silently overwrite the external version the user hasn't reviewed.
    // CLOSE-02.
    const isActive = prompt.id === activeTabIdRef.current;
    if (
      data.filePath &&
      (parkedAutosavePathsRef.current.has(pathKey(data.filePath)) || (isActive && conflictPromptRef.current))
    ) {
      setCloseTabPrompt(null);
      showToast(
        t("toast.conflictBeforeSave", { name: data.fileName }),
        "error",
      );
      return;
    }
    let path = data.filePath;
    let viaDownloads = false;
    if (path) {
      const newer = await diskChangedSince(path, data.knownMtime, data.originalContent);
      if (newer !== null) {
        parkedAutosavePathsRef.current.set(pathKey(path), newer);
        setCloseTabPrompt(null);
        if (isActive) setConflictPrompt({ fileName: data.fileName, diskMtime: newer });
        showToast(t("toast.conflictBeforeSave", { name: data.fileName }), "error");
        return;
      }
    } else {
      // A title-based name in the last-used folder, not "Untitled-1.md". SAVE-05.
      const selected = await promptForPath(suggestFileName(data.content, data.fileName), lastUsedDirectory(getRecentFiles()));
      if (!selected) return;
      const dlName = parseDownloadsSentinel(selected);
      if (dlName !== null) {
        // The prompt encodes the chosen filename in the sentinel; this hook
        // owns the content, so the native MediaStore write happens here.
        const cachePath = await saveViaDownloads(dlName || data.fileName, data.content);
        if (!cachePath) return;
        path = cachePath;
        viaDownloads = true;
      } else {
        path = selected;
      }
    }
    try {
      await saveTextFile(path, data.content, { skipExternalSync: viaDownloads });
    } catch (error) {
      showToast(errMessage(error) || t("toast.failedToSaveFile"), "error");
      return;
    }
    setCloseTabPrompt(null);
    finalizeCloseTab(prompt.id);
  }, [closeTabPrompt, diskChangedSince, finalizeCloseTab, getTabSaveData, promptForPath, saveViaDownloads, setConflictPrompt, showToast]);

  const handleDiscardCloseTab = useCallback(() => {
    const prompt = closeTabPrompt;
    setCloseTabPrompt(null);
    if (prompt) finalizeCloseTab(prompt.id);
  }, [closeTabPrompt, finalizeCloseTab]);

  const cancelCloseTab = useCallback(() => setCloseTabPrompt(null), []);

  // New file: opens a fresh Untitled buffer in its own tab (the current file
  // stays open in its tab, so nothing is discarded). Reuses a pristine empty
  // untitled tab if one exists, and numbers new ones Untitled-N.md. TABS-01/08.
  const handleNewFile = useCallback(() => {
    // Snapshot FIRST: the active tab's stored entry lags the live buffer until
    // the next switch, so a freshly-typed Untitled tab still looked "pristine
    // and empty" and New File silently did nothing. TABS-17.
    snapshotActiveTab();
    const reusable = findReusableUntitledTab(tabsRef.current);
    if (reusable) {
      if (reusable.id !== activeTabIdRef.current) activateTab(reusable.id);
      setMode("code");
      return;
    }
    // Fresh Untitled buffer → editor resets undo history. TABS-03.
    bumpDocSwap();
    const id = newTabId();
    const name = nextUntitledName(tabsRef.current);
    commitTabs([
      ...tabsRef.current,
      { id, filePath: null, fileName: name, content: "", originalContent: "", fileSize: 0, knownMtime: 0 },
    ]);
    setActiveTab(id);
    clearReview();
    setConflictPrompt(null);
    commitLive({
      filePath: null,
      fileName: name,
      content: "",
      originalContent: "",
      fileSize: 0,
      knownMtime: 0,
    });
    setLastFile(null);
    setMode("code");
  }, [activateTab, bumpDocSwap, clearReview, commitLive, commitTabs, newTabId, setActiveTab, setConflictPrompt, setMode, snapshotActiveTab]);

  // Open the interactive feature guide as a real, editable document. Reuse a
  // pristine empty untitled buffer when one exists; otherwise open a new tab so
  // the current file is left untouched. Split view shows source and result.
  const openTutorial = useCallback(
    (tutorialContent: string) => {
      const name = "Welcome to Paperling.md";
      // Normalize line endings ONCE, up front: the editor's doc normalizes
      // \r\n to \n on insert, so a CRLF tutorial.md (Windows checkout) made
      // the editor's onChange fire with text that differs from
      // originalContent — the freshly opened guide showed up pre-marked
      // "unsaved changes". TABS-09.
      const normalized = tutorialContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const bytes = new TextEncoder().encode(normalized).length;
      // Snapshot first so the active tab's latest edits are preserved even when
      // switching to (or reusing) another tab.
      snapshotActiveTab();
      // Fresh document → reset the editor's undo history. TABS-03.
      bumpDocSwap();
      const reusable = findReusableUntitledTab(tabsRef.current);
      const id = reusable ? reusable.id : newTabId();
      const entry: TabState = {
        id,
        filePath: null,
        fileName: name,
        content: normalized,
        originalContent: normalized,
        fileSize: bytes,
        knownMtime: 0,
      };
      commitTabs(
        reusable ? tabsRef.current.map((tab) => (tab.id === id ? entry : tab)) : [...tabsRef.current, entry],
      );
      setActiveTab(id);
      clearReview();
      setConflictPrompt(null);
      commitLive({
        filePath: null,
        fileName: name,
        content: normalized,
        originalContent: normalized,
        fileSize: bytes,
        knownMtime: 0,
      });
      setLastFile(null);
      setMode("split");
    },
    [bumpDocSwap, clearReview, commitLive, commitTabs, newTabId, setActiveTab, setConflictPrompt, setMode, snapshotActiveTab],
  );

  // Open file dialog.
  const handleOpenFile = useCallback(async () => {
    try {
      // Allow selecting several files at once — each opens in its own tab.
      // Plain-text files open too (rendered as markdown). TABS-11 / TXT-01.
      const selected = await open({
        multiple: true,
        filters: [{ name: "Markdown, text & HTML", extensions: [...DOCUMENT_EXTENSIONS] }],
        // Start next to the open note (or the last one used), not wherever
        // the OS dialog was last. SAVE-05.
        defaultPath: dirOf(filePathRef.current) ?? lastUsedDirectory(getRecentFiles()) ?? undefined,
      });
      if (typeof selected === "string") await loadFile(selected);
      else if (Array.isArray(selected)) for (const path of selected) await loadFile(path);
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  }, [loadFile]);

  // Save As — always prompts for a new path, even if a path is already set.
  const handleSaveAs = useCallback(async () => {
    // Capture origin tab BEFORE prompting so switching tabs mid-dialog never
    // writes under or stamps the wrong document.
    const originTabId = activeTabIdRef.current;
    const originPath = liveRef.current.filePath;
    const originName = liveRef.current.fileName;
    const originContent = liveRef.current.content;

    let selected = await promptForPath(
      originPath ? originName ?? null : suggestFileName(originContent, originName ?? "Untitled.md"),
      originPath ? dirOf(originPath) : lastUsedDirectory(getRecentFiles()),
    );
    if (!selected) return;
    let viaDownloads = false;
    const dlName = parseDownloadsSentinel(selected);
    if (dlName !== null) {
      const cachePath = await saveViaDownloads(dlName || originName || "Untitled.md", originContent);
      if (!cachePath) return;
      selected = cachePath;
      viaDownloads = true;
    }
    try {
      const writtenMtime = await saveTextFile(selected, originContent, { skipExternalSync: viaDownloads });
      const savedPath = selected;
      const savedKey = pathKey(savedPath);
      parkedAutosavePathsRef.current.delete(savedKey);

      const duplicates = tabsRef.current.filter((tab) => tab.id !== originTabId && samePath(tab.filePath, savedPath));
      for (const dup of duplicates) {
        if (dup.content !== dup.originalContent) parkedAutosavePathsRef.current.set(savedKey, writtenMtime);
      }
      const baseTabs = duplicates.some((dup) => dup.content === dup.originalContent)
        ? tabsRef.current.filter((tab) => !duplicates.some((dup) => dup.id === tab.id && dup.content === dup.originalContent))
        : tabsRef.current;

      const name = selected.replace(/\\/g, "/").split("/").pop() || "Untitled";
      addRecentFile(selected, name);

      if (originTabId) {
        commitTabs(
          baseTabs.map((tab) =>
            tab.id === originTabId
              ? {
                  ...tab,
                  filePath: selected,
                  fileName: name,
                  content: tab.id === activeTabIdRef.current ? liveRef.current.content : tab.content,
                  originalContent: originContent,
                  knownMtime: writtenMtime,
                }
              : tab,
          ),
        );
      } else if (baseTabs !== tabsRef.current) {
        commitTabs(baseTabs);
      }

      if (activeTabIdRef.current === originTabId) {
        commitLive({
          filePath: selected,
          fileName: name,
          originalContent: originContent,
          knownMtime: writtenMtime,
        });
        setLastFile(selected);
      }

      showToast(
        viaDownloads
          ? t("toast.savedToDownloadsAs", { name })
          : t("toast.fileSaved"),
        "success",
      );
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || t("toast.failedToSaveFile"), "error");
    }
  }, [commitLive, commitTabs, promptForPath, saveViaDownloads, showToast]);

  // Save file (Save As if no path yet).
  const handleSaveFile = useCallback(async () => {
    const targetPath = liveRef.current.filePath;
    const targetName = liveRef.current.fileName;
    const targetContent = liveRef.current.content;
    const originTabId = activeTabIdRef.current;

    if (!targetPath) {
      await handleSaveAs();
      return;
    }
    if (conflictPromptRef.current) {
      showToast(t("toast.conflictReviewFirst"), "info");
      return;
    }
    const newer = await diskChangedSince(targetPath, knownMtimeRef.current, originalContentRef.current);
    if (newer !== null) {
      parkedAutosavePathsRef.current.set(pathKey(targetPath), newer);
      if (samePath(filePathRef.current, targetPath)) {
        setConflictPrompt({ fileName: targetName ?? "Untitled.md", diskMtime: newer });
      }
      return;
    }
    try {
      const mtime = await saveTextFile(targetPath, targetContent);
      parkedAutosavePathsRef.current.delete(pathKey(targetPath));
      if (samePath(filePathRef.current, targetPath) && activeTabIdRef.current === originTabId) {
        commitLive({ originalContent: targetContent, knownMtime: mtime });
      } else {
        commitTabs(
          tabsRef.current.map((tab) =>
            (originTabId ? tab.id === originTabId : samePath(tab.filePath, targetPath))
              ? { ...tab, originalContent: targetContent, knownMtime: mtime }
              : tab,
          ),
        );
      }
      if (onSaved) onSaved();
      else showToast(t("toast.fileSaved"), "success");
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || t("toast.failedToSaveFile"), "error");
    }
  }, [commitLive, commitTabs, diskChangedSince, handleSaveAs, onSaved, setConflictPrompt, showToast]);

  const handleExternalReloaded = useCallback(
    (trigger: ExternalCheckTrigger) => {
      if (trigger === "focus") showToast(t("toast.reloadedLatest"), "info");
    },
    [showToast],
  );
  const handleExternalConflict = useCallback(
    (diskMtime?: number) => setConflictPrompt({ fileName: liveRef.current.fileName ?? "Untitled.md", diskMtime }),
    [setConflictPrompt],
  );
  const handleConflictKeepMine = useCallback(() => {
    const path = filePathRef.current;
    if (path) parkedAutosavePathsRef.current.delete(pathKey(path));
    // Absorb any usable on-disk mtime (including rollbacks where diskMtime < knownMtime). EXT-04/12/13.
    const diskMtime = conflictPromptRef.current?.diskMtime;
    if (diskMtime !== undefined && diskMtime > 0) knownMtimeRef.current = diskMtime;
    else if (diskMtime !== undefined && diskMtime <= 0 && path) keepMineMtimelessRef.current.add(pathKey(path));
    setConflictPrompt(null);
  }, [setConflictPrompt]);
  const handleConflictLoadFromDisk = useCallback(() => {
    const path = filePathRef.current;
    if (path) parkedAutosavePathsRef.current.delete(pathKey(path));
    setConflictPrompt(null);
    if (path) void loadFileDirect(path);
  }, [loadFileDirect, setConflictPrompt]);
  const reloadKeepingEdits = useCallback((path: string) => loadFileDirect(path, { keepEdits: true }), [loadFileDirect]);
  useExternalChangeWatcher({
    filePathRef,
    contentRef,
    originalContentRef,
    knownMtimeRef,
    isReviewActiveRef: reviewActiveRef,
    conflictPendingRef,
    reload: reloadKeepingEdits,
    onReloaded: handleExternalReloaded,
    onConflict: handleExternalConflict,
  });

  const handleAutosaved = useCallback((mtime: number, saved: string, savedPath: string) => {
    parkedAutosavePathsRef.current.delete(pathKey(savedPath));
    if (samePath(savedPath, filePathRef.current)) {
      commitLive({ originalContent: saved, knownMtime: mtime });
    } else {
      commitTabs(
        tabsRef.current.map((tab) =>
          samePath(tab.filePath, savedPath) && tab.content === saved
            ? { ...tab, originalContent: saved, knownMtime: mtime }
            : tab,
        ),
      );
    }
  }, [commitLive, commitTabs]);
  const handleAutosaveError = useCallback((message: string) => showToast(message, "error"), [showToast]);
  const autosaveBeforeWrite = useCallback(
    async (path: string): Promise<boolean> => {
      // Snapshot before waiting in case the active tab switches mid-stat.
      const known = knownMtimeRef.current;
      const original = originalContentRef.current;
      const newer = await diskChangedSince(path, known, original);
      if (newer === null) return true;
      parkedAutosavePathsRef.current.set(pathKey(path), newer);
      if (samePath(path, filePathRef.current)) {
        setConflictPrompt({ fileName: liveRef.current.fileName ?? "Untitled.md", diskMtime: newer });
      }
      return false;
    },
    [diskChangedSince, setConflictPrompt],
  );
  useAutosave({
    enabled: autoSaveEnabled,
    filePath,
    content,
    originalContent,
    isReviewActive,
    conflictPending: conflictPrompt != null,
    onSaved: handleAutosaved,
    onError: handleAutosaveError,
    beforeWrite: autosaveBeforeWrite,
  });

  // Autosave dirty BACKGROUND tabs too (useAutosave above covers the active
  // buffer). Background snapshots change only when switching away, so this
  // effect keys on `tabs` and settles after saved snapshots are updated. TABS-06.
  // Each write is guarded by a stat: if the file changed on disk since we last
  // saw it, saving would silently overwrite the external version — the exact
  // question the active-tab conflict dialog exists to ask. Park the path
  // instead and surface it once; the parking ends when the tab is resolved
  // (Keep-mine / Load-from-disk), reloaded, or closed. EXT-03.
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const activeId = activeTabIdRef.current;
    const dirtyBackgroundTabs = tabs.filter(
      (tab) => tab.id !== activeId && tab.filePath && tab.content !== tab.originalContent,
    );
    // A path is only parked while a dirty tab still holds it: closing the tab
    // or reverting the buffer ends the parking.
    for (const key of [...parkedAutosavePathsRef.current.keys()]) {
      if (!dirtyBackgroundTabs.some((tab) => pathKey(tab.filePath!) === key)) {
        parkedAutosavePathsRef.current.delete(key);
      }
    }
    if (dirtyBackgroundTabs.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (const tab of dirtyBackgroundTabs) {
        const path = tab.filePath!;
        const key = pathKey(path);
        if (parkedAutosavePathsRef.current.has(key)) continue;
        try {
          const info = await invoke<{ modified: number }>("get_file_info", { path });
          const decision = decideDiskChange(tab.knownMtime, info?.modified ?? 0);
          if (decision.kind === "changed") {
            const alreadyParked = parkedAutosavePathsRef.current.has(key);
            parkedAutosavePathsRef.current.set(key, info.modified);
            if (!alreadyParked) {
              showToast(
                t("toast.conflictBackground", { name: tab.fileName }),
                "error",
              );
            }
            continue;
          }
          if (decision.kind === "compare") {
            if (keepMineMtimelessRef.current.has(key)) {
              keepMineMtimelessRef.current.delete(key);
            } else {
              const disk = await readTextFile<{ content: string }>(path, { recordHistory: false }).catch(() => null);
              if (disk !== null && typeof disk.content === "string" && disk.content !== tab.originalContent) {
                const alreadyParked = parkedAutosavePathsRef.current.has(key);
                parkedAutosavePathsRef.current.set(key, info?.modified ?? 0);
                if (!alreadyParked) {
                  showToast(
                    t("toast.conflictBackground", { name: tab.fileName }),
                    "error",
                  );
                }
                continue;
              }
            }
          }
          const mtime = await saveTextFile(path, tab.content, { background: true });
          // Only mark saved if the snapshot still holds exactly what we wrote.
          commitTabs(
            tabsRef.current.map((current) =>
              current.id === tab.id && current.content === tab.content
                ? { ...current, originalContent: tab.content, knownMtime: mtime }
                : current,
            ),
          );
        } catch {
          // Best effort; active-tab saves surface disk errors.
        }
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, commitTabs, showToast, tabs]);

  // External-change detection for BACKGROUND tabs. The active tab is handled by
  // useExternalChangeWatcher; clean background tabs refresh silently, while a
  // dirty one advances its mtime and shows a one-time warning. TABS-06. Runs on
  // focus and on the visible-window interval; `checking` keeps a slow pass from
  // overlapping the next tick. EXT-07.
  useEffect(() => {
    let checking = false;
    const checkBackgroundTabs = async () => {
      const activeId = activeTabIdRef.current;
      const backgroundTabs = tabsRef.current.filter((tab) => tab.id !== activeId && tab.filePath);
      for (const tab of backgroundTabs) {
        // A background autosave of this tab overlapping the stat would read
        // as an external change (EXT-08); leave it to the next tick.
        const writeToken = idleWriteToken();
        if (writeToken === null) continue;
        try {
          const info = await invoke<{ modified: number }>("get_file_info", { path: tab.filePath! });
          if (idleWriteToken() !== writeToken) continue;
          // Re-read the tab: it may have been edited, reloaded or closed while
          // an earlier stat in this pass was in flight.
          const latest = tabsRef.current.find((current) => current.id === tab.id);
          if (!latest || latest.id === activeTabIdRef.current || !samePath(latest.filePath, tab.filePath)) continue;
          const decision = decideDiskChange(latest.knownMtime, info.modified);
          if (decision.kind === "unchanged") continue;
          if (decision.kind === "compare" && !(info.modified > 0)) continue;
          if (latest.content === latest.originalContent) {
            if (decision.kind === "compare" && latest.knownMtime > 0) {
              const probe = await readTextFile<{ content: string }>(tab.filePath!, { recordHistory: false }).catch(() => null);
              if (probe !== null && typeof probe.content === "string" && probe.content === latest.originalContent) {
                commitTabs(
                  tabsRef.current.map((current) =>
                    current.id === tab.id && current.knownMtime === latest.knownMtime
                      ? { ...current, knownMtime: info.modified }
                      : current,
                  ),
                );
                continue;
              }
            }
            const fileData = await readTextFile<FileData>(tab.filePath!);
            commitTabs(
              tabsRef.current.map((current) =>
                current.id === tab.id
                  ? {
                      ...current,
                      content: fileData.content,
                      originalContent: fileData.content,
                      fileSize: fileData.size,
                      knownMtime: fileData.modified ?? 0,
                    }
                  : current,
              ),
            );
          } else {
            let changed = decision.kind === "changed";
            if (!changed) {
              const disk = await readTextFile<{ content: string }>(tab.filePath!, { recordHistory: false }).catch(() => null);
              changed = disk !== null && typeof disk.content === "string" && disk.content !== latest.originalContent;
            }
            if (!changed) continue;
            const key = pathKey(tab.filePath!);
            if (!parkedAutosavePathsRef.current.has(key)) {
              parkedAutosavePathsRef.current.set(key, info.modified);
              showToast(
                t("toast.conflictBackground", { name: tab.fileName }),
                "error",
              );
            }
          }
        } catch {
          // Missing files and stat failures are surfaced when the tab is saved.
        }
      }
    };
    return subscribeExternalChecks(() => {
      if (checking) return;
      checking = true;
      void checkBackgroundTabs().finally(() => {
        checking = false;
      });
    });
  }, [commitTabs, showToast]);

  // Persist the whole open-tab session so a relaunch reopens every saved tab,
  // not just one file. Untitled buffers are omitted; the active tab's caret line
  // comes from currentLineRef because its stored snapshot can lag. TABS-07.
  useEffect(() => {
    // The boot effect reads the saved session later in this same effect phase.
    // Do not clear it from the initial empty tab state before restore runs.
    if (booting) return;
    const activeId = activeTabIdRef.current;
    const persistable = tabs.filter((tab) => tab.filePath);
    if (persistable.length === 0) {
      setSession(null);
      return;
    }
    const sessionTabs = persistable.map((tab) => ({
      path: tab.filePath!,
      cursorLine: tab.id === activeId ? currentLineRef.current : tab.cursorLine,
    }));
    const activeIndex = persistable.findIndex((tab) => tab.id === activeId);
    setSession({ tabs: sessionTabs, activeIndex: activeIndex < 0 ? 0 : activeIndex });
  }, [activeTabId, booting, tabs]);

  // Hot exit (HOT-01): mirror every DIRTY buffer's full text to the backup
  // store, debounced, so a crash / force-quit / OS reboot costs at most the
  // debounce window of work. Clean tabs are skipped (disk holds their state),
  // so saved/closed/reverted tabs age out of the store automatically.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const liveBackups = collectBufferBackups(tabsRef.current, activeTabIdRef.current, liveRef.current, currentLineRef.current);
      // HOT-08 (#228): the first note is editable before every disk read
      // finishes. Back it up immediately while retaining unread recovery
      // records. Distinct versions of a same-path note need separate targets
      // in storage too: the next launch indexes saved-file backups by path.
      const pending = booting ? pendingBootBackupsRef.current.flatMap((backup) => {
        const live = backup.filePath ? liveBackups.find((candidate) => samePath(candidate.filePath, backup.filePath)) : undefined;
        if (!live) return [backup];
        if (live.content === backup.content) return [];
        return [{ ...backup, filePath: null, fileName: `Recovered ${backup.fileName}` }];
      }) : [];
      saveBufferBackups([...pending, ...liveBackups]);
    }, 800);
    return () => window.clearTimeout(id);
  }, [booting, tabs, content, originalContent]);

  // Resolve the launch file once on app start. PULL model: ask the backend for
  // an OS-opened file when the UI is ready instead of racing a pushed event
  // against webview startup and session restoration.
  useEffect(() => {
    if (!restoreOnMount) {
      setBooting(false);
      return;
    }
    if (bootResolved) return;
    bootResolved = true;
    const backups = loadBufferBackups();
    pendingBootBackupsRef.current = backups;
    void (async () => {
      let cliFile: string | null = null;
      try {
        cliFile = await invoke<string | null>("get_cli_file");
      } catch {
        // Browser development mode or an older backend: restore only.
      }
      // Android "Open with": the Kotlin side copies the picked file into the
      // app cache and leaves a marker; pull it once. On the phone it wins the
      // same priority the double-clicked file has on desktop (there is no CLI
      // there), beating the last-session restore.
      let incoming: { path: string; name: string } | null = null;
      if (IS_MOBILE) {
        try {
          incoming = await invoke<{ path: string; name: string } | null>("get_incoming_file");
        } catch {
          // No pending file / older backend.
        }
      }
      // Prefer the full saved session (TABS-07); fall back to lastFile for
      // sessions saved before multi-tab restore existed.
      const reopenSession = getReopenSession();
      const session = reopenSession ? getSession() : null;
      const cursorByPath = new Map<string, number | undefined>();
      let paths: string[] = [];
      let activePath: string | null = null;
      if (session) {
        paths = session.tabs.map((tab) => tab.path);
        session.tabs.forEach((tab) => cursorByPath.set(pathKey(tab.path), tab.cursorLine));
        activePath = session.tabs[session.activeIndex]?.path ?? paths[0] ?? null;
      } else {
        const lastFile = reopenSession ? getLastFile() : null;
        if (lastFile) {
          paths = [lastFile];
          activePath = lastFile;
        }
      }
      // A CLI / double-clicked file (desktop) or an intent-opened file
      // (Android) is always the active tab, appended if new.
      const forcedFile = cliFile ?? incoming?.path ?? null;
      if (forcedFile) {
        if (!paths.some((p) => samePath(p, forcedFile))) paths.push(forcedFile);
        activePath = forcedFile;
      }
      // Hot exit (HOT-01): unsaved buffers from the previous run overlay the
      // restored session (and can seed one when nothing else restores).
      const backupByPath = new Map(backups.filter((b) => b.filePath).map((b) => [pathKey(b.filePath as string), b]));
      const untitledBackups = backups.filter((b) => !b.filePath);
      const hadNoSessionPaths = paths.length === 0;
      // Saved-file backups also pull their file back into the restore set.
      for (const b of backups) {
        if (b.filePath && !paths.some((p) => samePath(p, b.filePath))) paths.push(b.filePath);
      }
      if (paths.length === 0 && backups.length === 0) {
        setBooting(false);
        return;
      }
      let loaded: TabState[] = [];
      const publishedIds = new Set<string>();
      let activeId: string | null = null;
      let recoveredCount = 0;
      const readOrder = activePath ? [activePath, ...paths.filter((p) => !samePath(p, activePath))] : paths;
      for (const path of readOrder) {
        const pKey = pathKey(path);
        try {
          const fileData = await readTextFile<FileData>(path);
          const id = newTabId();
          const backup = backupByPath.get(pKey) ?? backupByPath.get(pathKey(fileData.path));
          const hasBackup = backup !== undefined && backup.content !== fileData.content;
          if (hasBackup) recoveredCount += 1;
          if (hasBackup && backup && backup.originalContent !== fileData.content) {
            parkedAutosavePathsRef.current.set(pathKey(fileData.path), fileData.modified ?? 0);
          }
          loaded.push({
            id,
            filePath: fileData.path,
            fileName: fileData.name,
            content: hasBackup && backup ? backup.content : fileData.content,
            originalContent: fileData.content,
            fileSize: fileData.size,
            knownMtime: fileData.modified ?? 0,
            cursorLine: backup?.cursorLine ?? cursorByPath.get(pKey),
          });
          if (samePath(path, activePath)) activeId = id;
          if (samePath(path, activePath) && tabsRef.current.length === 0) {
            const first = loaded[loaded.length - 1];
            pendingBootBackupsRef.current = pendingBootBackupsRef.current.filter((candidate) => candidate !== backup);
            publishedIds.add(id);
            commitTabs([first]);
            setActiveTab(id);
            applyTabToLive(first);
            if (getOpenInReader()) setMode("preview");
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
        } catch (error) {
          const backup = backupByPath.get(pKey);
          if (backup) {
            recoveredCount += 1;
            const id = newTabId();
            loaded.push({ id, filePath: null, fileName: backup.fileName, content: backup.content,
              originalContent: backup.originalContent, fileSize: new TextEncoder().encode(backup.content).length,
              knownMtime: 0, cursorLine: backup.cursorLine });
            if (samePath(path, activePath)) activeId = id;
          }
          const message = errMessage(error);
          if (forcedFile && samePath(path, forcedFile)) showToast(t("toast.couldNotOpenFile", { name: message || path }), "error");
          else if (/too large/i.test(message)) showToast(t("toast.couldNotRestore", { path, message }), "error");
        }
      }
      // Untitled dirty buffers become tabs of their own.
      for (const b of untitledBackups) {
        recoveredCount += 1;
        const id = newTabId();
        loaded.push({
          id,
          filePath: null,
          fileName: b.fileName,
          content: b.content,
          originalContent: b.originalContent,
          fileSize: new TextEncoder().encode(b.content).length,
          knownMtime: 0,
          cursorLine: b.cursorLine,
        });
        if (activeId === null) activeId = id;
      }
      // HOT-08: once published, a tab belongs entirely to live state. A
      // Save As or explicit Close/Discard while a background read is held
      // must not resurrect its stale launch snapshot at the final merge.
      loaded = loaded.filter((tab) => !publishedIds.has(tab.id));
      if (recoveredCount > 0) {
        showToast(
          recoveredCount === 1
            ? t("toast.recoveredOne")
            : t("toast.recoveredMany", { count: recoveredCount }),
          "info",
        );
      }
      if (loaded.length === 0) {
        if (hadNoSessionPaths) {
          // Nothing restored at all — no session, no readable backups.
          setSession(null);
          setLastFile(null);
        }
        setBooting(false);
        return;
      }
      // The user already opened or started something while the restore was
      // reading files (Ctrl+N, a drag-drop, a double-clicked .md forwarded by
      // the single-instance plugin). Replacing the tab list here silently
      // discarded that buffer, including anything typed into it. Merge the
      // restored tabs in instead and leave the user's tab on screen. BOOT-01.
      if (tabsRef.current.length > 0) {
        snapshotActiveTab();
        // HOT-07 (#228): active-first restore lets Files open a background
        // note before its backup read finishes. A same-path live tab must win
        // focus, but cannot discard a distinct recovered draft: the next
        // backup mirror would erase its only surviving copy. Keep that draft
        // as an unsaved recovery tab with no disk overwrite target. The
        // already-published active tab shares its id and needs no extra copy.
        const fresh = loaded.flatMap((tab) => {
          const existing = tab.filePath ? findTabByPath(tabsRef.current, tab.filePath) : undefined;
          if (!existing) return [tab];
          if (existing.id === tab.id || tab.content === tab.originalContent || tab.content === existing.content) return [];
          return [{ ...tab, filePath: null, fileName: `Recovered ${tab.fileName}`, knownMtime: 0 }];
        });
        const merged = [...fresh, ...tabsRef.current];
        // Retain the original tab-strip order despite active-first reads.
        merged.sort((a, b) => {
          const index = (tab: TabState) => tab.filePath ? paths.indexOf(tab.filePath) : paths.length;
          return index(a) - index(b);
        });
        commitTabs(merged);
        setBooting(false);
        return;
      }
      if (!activeId || !loaded.some((tab) => tab.id === activeId)) activeId = loaded[0].id;
      const activeTab = loaded.find((tab) => tab.id === activeId)!;
      bumpDocSwap();
      commitTabs(loaded);
      setActiveTab(activeId);
      setConflictPrompt(null);
      commitLive({
        filePath: activeTab.filePath,
        fileName: activeTab.fileName,
        content: activeTab.content,
        originalContent: activeTab.originalContent,
        fileSize: activeTab.fileSize,
        knownMtime: activeTab.knownMtime,
      });
      if (activeTab.filePath) {
        addRecentFile(activeTab.filePath, activeTab.fileName);
        const parkedKey = pathKey(activeTab.filePath);
        if (parkedAutosavePathsRef.current.has(parkedKey)) {
          setConflictPrompt({
            fileName: activeTab.fileName,
            diskMtime: parkedAutosavePathsRef.current.get(parkedKey),
          });
        }
      }
      setLastFile(activeTab.filePath);
      // Restore the active tab's caret line once the editor has mounted.
      const line = activeTab.cursorLine ?? 1;
      if (line > 1) {
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } })),
          150,
        );
      }
      // Applied once for the whole restored session, not per tab. READ-01.
      if (getOpenInReader()) setMode("preview");
      setBooting(false);
    })();
    // Launch resolution deliberately runs once per webview load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-reorder: move a tab to a new index. TABS-10.
  const handleReorderTab = useCallback(
    (fromIndex: number, toIndex: number) => commitTabs(moveTab(tabsRef.current, fromIndex, toIndex)),
    [commitTabs],
  );

  // Close a set of tabs, but only the CLEAN ones — dirty tabs are kept open
  // and reported. Used by "Close others / Close to the right". TABS-12.
  const closeManyClean = useCallback(
    (ids: string[]) => {
      let keptDirty = 0;
      for (const id of ids) {
        const tab = tabsRef.current.find((entry) => entry.id === id);
        if (!tab) continue;
        const dirty =
          id === activeTabIdRef.current
            ? liveRef.current.content !== liveRef.current.originalContent
            : tab.content !== tab.originalContent;
        if (dirty) {
          keptDirty++;
          continue;
        }
        finalizeCloseTab(id);
      }
      if (keptDirty > 0) {
        showToast(t("toast.keptDirtyTabs", { count: keptDirty }), "info");
      }
    },
    [finalizeCloseTab, showToast],
  );

  const handleTabMenuAction = useCallback(
    (action: "closeOthers" | "closeRight", id: string) => {
      const list = tabsRef.current;
      if (action === "closeOthers") closeManyClean(list.filter((tab) => tab.id !== id).map((tab) => tab.id));
      else {
        const index = list.findIndex((tab) => tab.id === id);
        if (index >= 0) closeManyClean(list.slice(index + 1).map((tab) => tab.id));
      }
      // Keep the anchor tab focused if it survived.
      if (tabsRef.current.some((tab) => tab.id === id) && id !== activeTabIdRef.current) activateTab(id);
    },
    [activateTab, closeManyClean],
  );

  // Buffer access by path for cross-file operations (replace in files). A file
  // open in a tab is edited IN ITS BUFFER — writing the disk behind the tab's
  // back was silently reverted by that tab's next autosave. The edit then
  // saves through the normal (guarded) save paths. GS-04.
  const getOpenBuffer = useCallback((path: string): string | null => {
    const tab = findTabByPath(tabsRef.current, path);
    if (!tab) return null;
    // Right after a switch the active-tab id already points at `tab`, but the
    // live buffer still holds the PREVIOUS file until the next render; only
    // trust it when it really is this file. `[[Note#Heading]]` to an already
    // open note used to search the wrong text and never jumped. NAV-12.
    return tab.id === activeTabIdRef.current && samePath(liveRef.current.filePath, tab.filePath)
      ? liveRef.current.content
      : tab.content;
  }, []);
  const setOpenBuffer = useCallback(
    (path: string, text: string): boolean => {
      const tab = findTabByPath(tabsRef.current, path);
      if (!tab) return false;
      if (tab.id === activeTabIdRef.current) {
        setContent(text);
      } else {
        commitTabs(tabsRef.current.map((t) => (t.id === tab.id ? { ...t, content: text } : t)));
      }
      return true;
    },
    [commitTabs],
  );

  // The explorer renamed or trashed `oldPath` (a file, or a folder and
  // everything under it). Open tabs follow a rename. For a trash, a clean
  // tab closes and a dirty one keeps its text but loses its path — its
  // autosave would otherwise silently re-create the file the user just
  // deleted; saving it now asks where. FILES-01.
  const retargetPaths = useCallback(
    (oldPath: string, newPath: string | null): number => {
      retargetEncodings(oldPath, newPath);
      const oldKey = pathKey(oldPath);
      const mapPath = (p: string | null): string | null | undefined => {
        if (!p) return undefined;
        const key = pathKey(p);
        if (key === oldKey) return newPath;
        if (key.startsWith(`${oldKey}/`)) return newPath ? newPath + p.slice(oldPath.length) : null;
        return undefined;
      };
      const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;
      const activeId = activeTabIdRef.current;
      let affected = 0;
      const toClose: string[] = [];
      const next = tabsRef.current.map((tab) => {
        const isActive = tab.id === activeId;
        const currentPath = isActive ? liveRef.current.filePath : tab.filePath;
        const mapped = mapPath(currentPath);
        if (mapped === undefined) return tab;
        affected += 1;
        if (currentPath) parkedAutosavePathsRef.current.delete(pathKey(currentPath));
        const dirty = isActive
          ? liveRef.current.content !== liveRef.current.originalContent
          : tab.content !== tab.originalContent;
        if (mapped === null && !dirty) {
          toClose.push(tab.id);
          return tab;
        }
        const updated = { ...tab, filePath: mapped, fileName: mapped ? baseName(mapped) : tab.fileName };
        if (isActive) {
          commitLive({
            filePath: mapped,
            ...(mapped ? { fileName: baseName(mapped) } : {}),
          });
          setLastFile(mapped ?? null);
        }
        return updated;
      });
      commitTabs(next);
      for (const id of toClose) finalizeCloseTab(id);
      return affected;
    },
    [commitLive, commitTabs, finalizeCloseTab],
  );

  return {
    retargetPaths,
    getOpenBuffer,
    setOpenBuffer,
    filePath,
    fileName,
    content,
    setContent,
    originalContent,
    fileSize,
    tabs,
    activeTabId,
    docSwapId,
    booting,
    isLoading,
    isDirty,
    hasFile,
    closeTabPrompt,
    cancelCloseTab,
    conflictPrompt,
    handleConflictKeepMine,
    handleConflictLoadFromDisk,
    collectDirtyTabs,
    checkTabDiskChanged,
    markTabSaved,
    isAutosaveParked,
    loadFileDirect,
    activateTab,
    cycleTab,
    loadFile,
    reopenClosedTab,
    gotoTabByIndex,
    closeTab,
    handleSaveCloseTab,
    handleDiscardCloseTab,
    handleNewFile,
    openTutorial,
    handleOpenFile,
    handleSaveAs,
    handleSaveFile,
    handleReorderTab,
    handleTabMenuAction,
  };
}
