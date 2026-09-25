import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readTextFile, saveTextFile } from "../utils/fileIO";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { ViewMode } from "../components/ModeToggle";
import type { ToastType } from "./useToast";
import { useAutosave } from "./useAutosave";
import { useExternalChangeWatcher } from "./useExternalChangeWatcher";
import { IS_MOBILE } from "../utils/platform";
import { errMessage } from "../utils/errors";
import { DOWNLOADS_SENTINEL, saveToDownloads } from "../utils/nativePicker";
import { normalizeMarkdownFileName } from "../utils/mobileFiles";
import {
  addRecentFile,
  getLastFile,
  getOpenInReader,
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

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
  /** Last-modified time (ms since epoch) — used to detect external edits. */
  modified: number;
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
    promptSavePath?: (defaultName: string | null) => Promise<string | null>;
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
    restoreOnMount = true,
}: UseFileSessionOptions) {
  // File state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState("");
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
  const setConflictPrompt = useCallback((next: { fileName: string; diskMtime?: number } | null) => {
    conflictPromptRef.current = next;
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
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;
  // Stack of recently-closed tabs (path + caret line) for Ctrl+Shift+T. Only
  // saved files are recoverable; untitled buffers aren't pushed. TABS-15.
  const closedTabsRef = useRef<{ path: string; cursorLine?: number }[]>([]);
  const liveRef = useRef({ filePath, fileName, content, originalContent, fileSize });
  liveRef.current = { filePath, fileName, content, originalContent, fileSize };
  // The line we'd return to when this file is re-activated: the caret line while
  // editing, or the top-visible line in reader mode. TABS-02.
  const currentLineRef = useRef(1);
  currentLineRef.current = currentLine;
  // Known on-disk modified time (ms). Compared against a fresh stat on window
  // focus to detect the file changing under us (sync tools, other editors).
  const knownMtimeRef = useRef(0);
  // Paths whose background autosave is parked because the file changed on disk
  // under a dirty buffer (detected by the pre-write stat in the background
  // autosave effect). A parked path is never written automatically — switching
  // to its tab raises the conflict dialog, and Keep-mine / Load-from-disk (or
  // closing the tab) ends the parking. Without this, the 1.5s background timer
  // would answer the conflict question by silently overwriting the external
  // changes. EXT-03.
  // Maps path → the on-disk mtime seen when it was parked, so "Keep mine" can
  // absorb exactly that change (EXT-04/05).
  const parkedAutosavePathsRef = useRef<Map<string, number>>(new Map());
  // Latest content + originalContent are read via refs inside `loadFile` so
  // its identity stays stable across keystrokes. Without this, every typed
  // character would change `loadFile`'s reference and churn its listeners.
  const contentRef = useRef(content);
  contentRef.current = content;
  const originalContentRef = useRef(originalContent);
  originalContentRef.current = originalContent;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  // Whether an AI review is pending, mirrored into a ref for the focus-time
  // external-change watcher (registered once, so it can't read state directly).
  // AI-01.
  const reviewActiveRef = useRef(isReviewActive);
  reviewActiveRef.current = isReviewActive;

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
    (path: string | null | undefined): boolean => !!path && parkedAutosavePathsRef.current.has(path),
    [],
  );

  // Write the live editor state back into the active tab's entry.
  const snapshotActiveTab = useCallback(() => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const live = liveRef.current;
    // Leaving a tab while its disk-conflict dialog is open must NOT count as
    // "keep mine": the buffer becomes a dirty background tab whose knownMtime
    // already equals the external mtime, so background autosave would
    // overwrite the external version 1.5s later. Park it instead — switching
    // back re-raises the dialog. A tab switch is reachable behind the modal
    // (Alt+Arrows, Ctrl+Tab, tab clicks). EXT-04.
    const pending = conflictPromptRef.current;
    if (pending && live.filePath && live.content !== live.originalContent) {
      parkedAutosavePathsRef.current.set(live.filePath, pending.diskMtime ?? knownMtimeRef.current);
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
      // Switching away from a file with a pending disk conflict resolves it as
      // "keep mine": the watcher already absorbed the new mtime, so the choice
      // only mattered while that buffer was on screen. EXT-02.
      setConflictPrompt(null);
      bumpDocSwap();
      setFilePath(tab.filePath);
      setFileName(tab.fileName);
      setContent(tab.content);
      setOriginalContent(tab.originalContent);
      setFileSize(tab.fileSize);
      knownMtimeRef.current = tab.knownMtime;
      // A tab parked by the background-autosave guard has external changes the
      // user hasn't reviewed. Raising the conflict dialog here parks the
      // ACTIVE autosave (conflictPending) until Keep-mine / Load-from-disk —
      // otherwise the first edit after the switch would re-create the exact
      // overwrite the guard exists to prevent. EXT-03.
      if (tab.filePath && parkedAutosavePathsRef.current.has(tab.filePath)) {
        setConflictPrompt({ fileName: tab.fileName, diskMtime: parkedAutosavePathsRef.current.get(tab.filePath) });
      }
      if (tab.filePath) setLastFile(tab.filePath);
      // Restore where you were in this tab — jump to the remembered line, or fall
      // back to the top for a never-focused / line-1 tab. TABS-02.
      // `source: "tab-restore"` lets the editor skip this when it restored the
      // tab's full state (exact caret + viewport) itself. TABS-20.
      const line = tab.cursorLine ?? 1;
      requestAnimationFrame(() => {
        if (line > 1) window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line, source: "tab-restore" } }));
        else window.dispatchEvent(new CustomEvent("paperling:scroll-top", { detail: { source: "tab-restore" } }));
      });
    },
    [bumpDocSwap, clearReview, setConflictPrompt],
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

  // Load a file directly from disk into the tab model.
  const loadFileDirect = useCallback(
    async (path: string) => {
      const outgoing = filePathRef.current;
      // Preserve the file we're leaving in its tab before overwriting live state.
      snapshotActiveTab();
      setIsLoading(true);
      try {
        const fileData = await readTextFile<FileData>(path);
        // A fresh load is a clean slate for every overlay: a review pending from
        // the PREVIOUS file must not survive into this one (its merge view would
        // diff old-file content against the new document, and its chunk buttons
        // would write the old file's proposed text here), a stale conflict
        // prompt must not keep this file's saves parked, and any background
        // parking for this path is moot — we just read the disk version.
        // EXT-02 / AI-02.
        clearReview();
        setConflictPrompt(null);
        parkedAutosavePathsRef.current.delete(fileData.path);
        bumpDocSwap();
        setFilePath(fileData.path);
        setFileName(fileData.name);
        setContent(fileData.content);
        setOriginalContent(fileData.content);
        setFileSize(fileData.size);
        knownMtimeRef.current = fileData.modified ?? 0;
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
          commitTabs([...tabsRef.current, { id, ...loaded }]);
          setActiveTab(id);
        }
        // Snap the new file to the top — but not on a same-path external reload,
        // which should keep the reader where they were. NAV-04.
        if (outgoing !== fileData.path) {
          requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("paperling:scroll-top")));
        }
        // "Open files in reader" applies to every USER file open, read live so
        // a Settings change takes effect without a restart. Same-path reloads
        // are excluded: the external-change watcher reloads through here
        // (EXT-01) and must not yank an editing session to preview. READ-01.
        if (outgoing !== fileData.path && getOpenInReader()) setMode("preview");
      } catch (error) {
        console.error("Failed to load file:", error);
        // Surface the actual Rust error so size/not-found failures reach the user.
        showToast(errMessage(error) || "Failed to open file", "error");
      } finally {
        setIsLoading(false);
      }
    },
    [bumpDocSwap, clearReview, commitTabs, newTabId, setActiveTab, setConflictPrompt, setMode, showToast, snapshotActiveTab],
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
        bumpDocSwap();
        setFilePath(null);
        setFileName(null);
        setContent("");
        setOriginalContent("");
        setFileSize(0);
        knownMtimeRef.current = 0;
        setLastFile(null);
      }
    },
    [applyTabToLive, bumpDocSwap, clearReview, commitTabs, setActiveTab],
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
    };
  }, []);

  // Ask where an untitled buffer should live: the injected strategy when the
  // shell provides one (mobile name prompt), otherwise the OS save panel.
  const promptForPath = useCallback(
    (defaultName: string | null): Promise<string | null> => {
      if (promptSavePath) return promptSavePath(defaultName);
      return save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: defaultName ?? undefined,
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
        showToast(result.error || "Could not save to Downloads", "error");
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
      (parkedAutosavePathsRef.current.has(data.filePath) || (isActive && conflictPromptRef.current))
    ) {
      setCloseTabPrompt(null);
      showToast(
        `"${data.fileName}" changed on disk. Resolve the conflict (switch to the tab) before saving it.`,
        "error",
      );
      return;
    }
    let path = data.filePath;
    if (!path) {
      const selected = await promptForPath(data.fileName);
      if (!selected) return;
      if (selected === DOWNLOADS_SENTINEL) {
        // The prompt can only hand back the sentinel; this hook owns the
        // content, so the native MediaStore write happens here.
        const cachePath = await saveViaDownloads(data.fileName, data.content);
        if (!cachePath) return;
        path = cachePath;
      } else {
        path = selected;
      }
    }
    try {
      await saveTextFile(path, data.content);
    } catch (error) {
      showToast(errMessage(error) || "Failed to save file", "error");
      return;
    }
    setCloseTabPrompt(null);
    finalizeCloseTab(prompt.id);
  }, [closeTabPrompt, finalizeCloseTab, getTabSaveData, promptForPath, saveViaDownloads, showToast]);

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
    setFilePath(null);
    setFileName(name);
    setContent("");
    setOriginalContent("");
    setFileSize(0);
    knownMtimeRef.current = 0;
    setLastFile(null);
    setMode("code");
  }, [activateTab, bumpDocSwap, clearReview, commitTabs, newTabId, setActiveTab, setMode, snapshotActiveTab]);

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
      setFilePath(null);
      setFileName(name);
      setContent(normalized);
      setOriginalContent(normalized);
      setFileSize(bytes);
      knownMtimeRef.current = 0;
      setLastFile(null);
      setMode("split");
    },
    [bumpDocSwap, clearReview, commitTabs, newTabId, setActiveTab, setMode, snapshotActiveTab],
  );

  // Open file dialog.
  const handleOpenFile = useCallback(async () => {
    try {
      // Allow selecting several files at once — each opens in its own tab.
      // Plain-text files open too (rendered as markdown). TABS-11 / TXT-01.
      const selected = await open({
        multiple: true,
        filters: [{ name: "Markdown & text", extensions: ["md", "markdown", "txt", "text"] }],
      });
      if (typeof selected === "string") await loadFile(selected);
      else if (Array.isArray(selected)) for (const path of selected) await loadFile(path);
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  }, [loadFile]);

  // The on-disk mtime of `path` when it is NEWER than what the active buffer
  // last read or wrote, else null (unchanged, untracked, or stat failed — the
  // write itself then surfaces real errors). Shared pre-write guard for the
  // active tab's manual save and autosave. EXT-06.
  const diskChangedSince = useCallback(async (path: string): Promise<number | null> => {
    try {
      const info = await invoke<{ modified: number }>("get_file_info", { path });
      const known = knownMtimeRef.current;
      return known > 0 && typeof info?.modified === "number" && info.modified > known ? info.modified : null;
    } catch {
      return null;
    }
  }, []);

  // Save As — always prompts for a new path, even if a path is already set.
  const handleSaveAs = useCallback(async () => {
    let selected = await promptForPath(fileName ?? null);
    if (!selected) return;
    let viaDownloads = false;
    if (selected === DOWNLOADS_SENTINEL) {
      const cachePath = await saveViaDownloads(fileName ?? "Untitled.md", content);
      if (!cachePath) return;
      selected = cachePath;
      viaDownloads = true;
    }
    try {
      knownMtimeRef.current = await saveTextFile(selected, content);
      const savedPath = selected;
      // Saving over a file that is open in ANOTHER tab left two tabs for one
      // file whose saves clobbered each other. A clean duplicate just closes;
      // a dirty one is parked so the conflict dialog decides when it's next
      // opened (its buffer no longer matches what's on disk). TABS-18.
      const selfId = activeTabIdRef.current;
      const duplicates = tabsRef.current.filter((tab) => tab.id !== selfId && samePath(tab.filePath, savedPath));
      for (const dup of duplicates) {
        if (dup.content !== dup.originalContent) parkedAutosavePathsRef.current.set(savedPath, knownMtimeRef.current);
      }
      if (duplicates.some((dup) => dup.content === dup.originalContent)) {
        commitTabs(
          tabsRef.current.filter(
            (tab) => !duplicates.some((dup) => dup.id === tab.id && dup.content === dup.originalContent),
          ),
        );
      }
      setFilePath(selected);
      const name = selected.replace(/\\/g, "/").split("/").pop() || "Untitled";
      setFileName(name);
      setOriginalContent(content);
      addRecentFile(selected, name);
      setLastFile(selected);
      // Keep the active tab's entry in step with the new path/name so reopening
      // the just-saved file switches to this tab instead of duplicating it. TABS-01.
      const activeId = activeTabIdRef.current;
      if (activeId) {
        commitTabs(
          tabsRef.current.map((tab) =>
            tab.id === activeId
              ? {
                  ...tab,
                  filePath: selected,
                  fileName: name,
                  content,
                  originalContent: content,
                  knownMtime: knownMtimeRef.current,
                }
              : tab,
          ),
        );
      }
      showToast(
        viaDownloads
          ? `Saved to Downloads as "${name}" — a working copy lives in your notes folder`
          : "File saved",
        "success",
      );
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || "Failed to save file", "error");
    }
  }, [commitTabs, content, fileName, promptForPath, saveViaDownloads, showToast]);

  // Save file (Save As if no path yet).
  const handleSaveFile = useCallback(async () => {
    if (!filePath) {
      await handleSaveAs();
      return;
    }
    // A disk conflict is pending: saving now would silently overwrite the
    // external changes the dialog is asking about. Save As stays allowed —
    // it writes to a different path. EXT-02.
    if (conflictPrompt) {
      showToast("This file changed on disk — pick a version in the dialog first", "info");
      return;
    }
    // Same pre-write check autosave runs: a file changed by another program
    // since we last read/wrote it raises the conflict dialog instead of being
    // overwritten. EXT-06.
    const newer = await diskChangedSince(filePath);
    if (newer !== null) {
      setConflictPrompt({ fileName: fileName ?? "Untitled.md", diskMtime: newer });
      return;
    }
    try {
      knownMtimeRef.current = await saveTextFile(filePath, content);
      setOriginalContent(content);
      showToast("File saved", "success");
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || "Failed to save file", "error");
    }
  }, [conflictPrompt, content, diskChangedSince, fileName, filePath, handleSaveAs, setConflictPrompt, showToast]);

  // External-change detection: on window focus, stat the open file and reload
  // a clean buffer or prompt for a dirty buffer. EXT-01. Callbacks are memoised
  // so the focus listener stays registered across renders.
  const handleExternalReloaded = useCallback(
    () => showToast("File changed on disk, reloaded the latest version", "info"),
    [showToast],
  );
  const handleExternalConflict = useCallback(
    () => setConflictPrompt({ fileName: liveRef.current.fileName ?? "Untitled.md" }),
    [setConflictPrompt],
  );
  // Resolution for the disk-conflict dialog. "Keep mine" changes nothing on
  // disk: the watcher already absorbed the new mtime, so the next save (manual
  // or autosave) deliberately overwrites the external version. "Load from disk"
  // reuses the watcher's reload path, which resets content/originalContent and
  // the known mtime. EXT-02. Both resolutions also end any background-autosave
  // parking for the path — the user has explicitly decided. EXT-03.
  const handleConflictKeepMine = useCallback(() => {
    const path = filePathRef.current;
    if (path) parkedAutosavePathsRef.current.delete(path);
    // Absorb the disk change the user just chose to overwrite; otherwise the
    // pre-write guard would see it again and re-raise the dialog. EXT-04.
    const diskMtime = conflictPromptRef.current?.diskMtime;
    if (diskMtime !== undefined && diskMtime > knownMtimeRef.current) knownMtimeRef.current = diskMtime;
    setConflictPrompt(null);
  }, [setConflictPrompt]);
  const handleConflictLoadFromDisk = useCallback(() => {
    const path = filePathRef.current;
    if (path) parkedAutosavePathsRef.current.delete(path);
    setConflictPrompt(null);
    if (path) void loadFileDirect(path);
  }, [loadFileDirect, setConflictPrompt]);
  useExternalChangeWatcher({
    filePathRef,
    contentRef,
    originalContentRef,
    knownMtimeRef,
    isReviewActiveRef: reviewActiveRef,
    reload: loadFileDirect,
    onReloaded: handleExternalReloaded,
    onConflict: handleExternalConflict,
  });

  // Autosave 1.5s after the last edit. See useAutosave for throttling and the
  // AI-review guard (AI-01); memoised callbacks keep the timer stable. A pending
  // disk conflict parks autosave too — saving is exactly what the dialog is
  // asking about. EXT-02. The saved path lets us ignore a resolution that lands
  // after the user switched documents mid-write: stamping the NEW buffer with
  // this file's mtime/originalContent corrupted its dirty flag (a later close
  // could discard real edits as "clean") and its external-change detection.
  // TABS-08.
  const handleAutosaved = useCallback((mtime: number, saved: string, savedPath: string) => {
    if (savedPath !== filePathRef.current) return;
    knownMtimeRef.current = mtime;
    setOriginalContent(saved);
  }, []);
  const handleAutosaveError = useCallback((message: string) => showToast(message, "error"), [showToast]);
  // Pre-write guard for the active tab's autosave: the file changed on disk
  // since we last read/wrote it → raise the conflict dialog (which parks
  // autosave) instead of overwriting. Before this, only BACKGROUND tabs were
  // guarded, so an external edit (or a replace-in-files) was silently
  // reverted ≤1.5s later whenever the active buffer was dirty. EXT-06/GS-04.
  const autosaveBeforeWrite = useCallback(
    async (path: string): Promise<boolean> => {
      const newer = await diskChangedSince(path);
      if (newer === null) return true;
      if (path === filePathRef.current) {
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
    for (const path of [...parkedAutosavePathsRef.current.keys()]) {
      if (!dirtyBackgroundTabs.some((tab) => tab.filePath === path)) {
        parkedAutosavePathsRef.current.delete(path);
      }
    }
    if (dirtyBackgroundTabs.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (const tab of dirtyBackgroundTabs) {
        const path = tab.filePath!;
        if (parkedAutosavePathsRef.current.has(path)) continue;
        try {
          const info = await invoke<{ modified: number }>("get_file_info", { path });
          if (tab.knownMtime > 0 && info.modified > tab.knownMtime) {
            const alreadyParked = parkedAutosavePathsRef.current.has(path);
            parkedAutosavePathsRef.current.set(path, info.modified);
            if (!alreadyParked) {
              showToast(
                `"${tab.fileName}" changed on disk in a background tab. Its autosave is paused until you review the changes.`,
                "error",
              );
            }
            continue;
          }
          const mtime = await saveTextFile(path, tab.content);
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
  // dirty one advances its mtime and shows a one-time warning. TABS-06.
  useEffect(() => {
    const onFocus = async () => {
      const activeId = activeTabIdRef.current;
      const backgroundTabs = tabsRef.current.filter((tab) => tab.id !== activeId && tab.filePath);
      for (const tab of backgroundTabs) {
        try {
          const info = await invoke<{ modified: number }>("get_file_info", { path: tab.filePath! });
          if (!(tab.knownMtime > 0 && info.modified > tab.knownMtime)) continue;
          if (tab.content === tab.originalContent) {
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
          } else if (!parkedAutosavePathsRef.current.has(tab.filePath!)) {
            // Park — do NOT absorb the new mtime into the snapshot. Absorbing
            // it made the background-autosave guard see "nothing new" and
            // overwrite the very change this branch just warned about.
            // Switching to the tab raises the conflict dialog. EXT-05.
            parkedAutosavePathsRef.current.set(tab.filePath!, info.modified);
            showToast(
              `"${tab.fileName}" changed on disk in a background tab. Its autosave is paused until you review the changes.`,
              "error",
            );
          }
        } catch {
          // Missing files and stat failures are surfaced when the tab is saved.
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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
    if (booting) return;
    const id = window.setTimeout(() => {
      saveBufferBackups(
        collectBufferBackups(tabsRef.current, activeTabIdRef.current, liveRef.current, currentLineRef.current),
      );
    }, 800);
    return () => window.clearTimeout(id);
  }, [booting, tabs, content]);

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
      const session = getSession();
      const cursorByPath = new Map<string, number | undefined>();
      let paths: string[] = [];
      let activePath: string | null = null;
      if (session) {
        paths = session.tabs.map((tab) => tab.path);
        session.tabs.forEach((tab) => cursorByPath.set(tab.path, tab.cursorLine));
        activePath = session.tabs[session.activeIndex]?.path ?? paths[0] ?? null;
      } else {
        const lastFile = getLastFile();
        if (lastFile) {
          paths = [lastFile];
          activePath = lastFile;
        }
      }
      // A CLI / double-clicked file (desktop) or an intent-opened file
      // (Android) is always the active tab, appended if new.
      const forcedFile = cliFile ?? incoming?.path ?? null;
      if (forcedFile) {
        if (!paths.includes(forcedFile)) paths.push(forcedFile);
        activePath = forcedFile;
      }
      // Hot exit (HOT-01): unsaved buffers from the previous run overlay the
      // restored session (and can seed one when nothing else restores).
      const backups = loadBufferBackups();
      const backupByPath = new Map(backups.filter((b) => b.filePath).map((b) => [b.filePath as string, b]));
      const untitledBackups = backups.filter((b) => !b.filePath);
      const hadNoSessionPaths = paths.length === 0;
      // Saved-file backups also pull their file back into the restore set.
      for (const b of backupByPath.keys()) {
        if (!paths.includes(b)) paths.push(b);
      }
      if (paths.length === 0 && backups.length === 0) {
        setBooting(false);
        return;
      }
      // Read each file, skipping stale entries. Always surface a forced-open
      // file's failure (CLI arg or Android intent) — the user explicitly
      // requested it from outside the app.
      const loaded: TabState[] = [];
      let activeId: string | null = null;
      let recoveredCount = 0;
      for (const path of paths) {
        try {
          const fileData = await readTextFile<FileData>(path);
          const id = newTabId();
          const backup = backupByPath.get(path);
          // Dirty backup for this file: restore the BUFFER text over the disk
          // content (disk stays `originalContent`, so the buffer reads dirty).
          const hasBackup = backup !== undefined && backup.content !== fileData.content;
          if (hasBackup) recoveredCount += 1;
          // The file changed on disk AFTER the backup was taken (edited in
          // another program between the crash and this launch): the backup's
          // base no longer matches the disk. Restore the buffer but park the
          // path, so the conflict dialog (Keep mine / Load from disk / Save a
          // copy) decides — never let autosave lay stale recovered text over
          // newer work. HOT-04.
          if (hasBackup && backup && backup.originalContent !== fileData.content) {
            parkedAutosavePathsRef.current.set(fileData.path, fileData.modified ?? 0);
          }
          loaded.push({
            id,
            filePath: fileData.path,
            fileName: fileData.name,
            content: hasBackup && backup ? backup.content : fileData.content,
            originalContent: fileData.content,
            fileSize: fileData.size,
            knownMtime: fileData.modified ?? 0,
            cursorLine: backup?.cursorLine ?? cursorByPath.get(path),
          });
          if (path === activePath) activeId = id;
        } catch (error) {
          const message = errMessage(error);
          if (forcedFile && path === forcedFile) showToast(`Could not open file: ${message || path}`, "error");
          else if (/too large/i.test(message)) showToast(`Could not restore "${path}": ${message}`, "error");
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
      if (recoveredCount > 0) {
        showToast(
          recoveredCount === 1
            ? "Recovered 1 unsaved buffer from the last session"
            : `Recovered ${recoveredCount} unsaved buffers from the last session`,
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
        const fresh = loaded.filter((tab) => !tab.filePath || !findTabByPath(tabsRef.current, tab.filePath));
        commitTabs([...fresh, ...tabsRef.current]);
        setBooting(false);
        return;
      }
      if (!activeId) activeId = loaded[0].id;
      const activeTab = loaded.find((tab) => tab.id === activeId)!;
      bumpDocSwap();
      commitTabs(loaded);
      setActiveTab(activeId);
      setFilePath(activeTab.filePath);
      setFileName(activeTab.fileName);
      setContent(activeTab.content);
      // The snapshot's originalContent, NOT its content: for a recovered
      // buffer they differ, and seeding originalContent with the recovered
      // text made the tab read "Saved" — no close prompt, no autosave, and the
      // hot-exit store dropped the backup 800ms later, so the recovered work
      // was lost on the next close or crash. HOT-02.
      setOriginalContent(activeTab.originalContent);
      setFileSize(activeTab.fileSize);
      knownMtimeRef.current = activeTab.knownMtime;
      if (activeTab.filePath) {
        addRecentFile(activeTab.filePath, activeTab.fileName);
        if (parkedAutosavePathsRef.current.has(activeTab.filePath)) {
          setConflictPrompt({
            fileName: activeTab.fileName,
            diskMtime: parkedAutosavePathsRef.current.get(activeTab.filePath),
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
        showToast(`Kept ${keptDirty} unsaved tab${keptDirty > 1 ? "s" : ""} open`, "info");
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
    return tab.id === activeTabIdRef.current ? liveRef.current.content : tab.content;
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
        if (currentPath) parkedAutosavePathsRef.current.delete(currentPath);
        const dirty = isActive
          ? liveRef.current.content !== liveRef.current.originalContent
          : tab.content !== tab.originalContent;
        if (mapped === null && !dirty) {
          toClose.push(tab.id);
          return tab;
        }
        const updated = { ...tab, filePath: mapped, fileName: mapped ? baseName(mapped) : tab.fileName };
        if (isActive) {
          setFilePath(mapped);
          if (mapped) {
            setFileName(baseName(mapped));
            setLastFile(mapped);
          } else {
            setLastFile(null);
          }
        }
        return updated;
      });
      commitTabs(next);
      for (const id of toClose) finalizeCloseTab(id);
      return affected;
    },
    [commitTabs, finalizeCloseTab],
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
