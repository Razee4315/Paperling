import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  collectDirtyTabs as computeDirtyTabs,
  findReusableUntitledTab,
  findTabByPath,
  moveTab,
  nextActiveAfterClose,
  nextUntitledName,
  type DirtyTab,
  type TabState,
} from "../utils/tabsModel";

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
  const [conflictPrompt, setConflictPrompt] = useState<{ fileName: string } | null>(null);

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

  // Write the live editor state back into the active tab's entry.
  const snapshotActiveTab = useCallback(() => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const live = liveRef.current;
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
      if (tab.filePath) setLastFile(tab.filePath);
      // Restore where you were in this tab — jump to the remembered line, or fall
      // back to the top for a never-focused / line-1 tab. TABS-02.
      const line = tab.cursorLine ?? 1;
      requestAnimationFrame(() => {
        if (line > 1) window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } }));
        else window.dispatchEvent(new CustomEvent("paperling:scroll-top"));
      });
    },
    [bumpDocSwap, clearReview],
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
        const fileData = await invoke<FileData>("read_file", { path });
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
    [bumpDocSwap, commitTabs, newTabId, setActiveTab, setMode, showToast, snapshotActiveTab],
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
  const reopenClosedTab = useCallback(() => {
    const entry = closedTabsRef.current.pop();
    if (!entry) return;
    loadFile(entry.path);
    if (entry.cursorLine && entry.cursorLine > 1) {
      const line = entry.cursorLine;
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } })),
        150,
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
      await invoke("save_file", { path, content: data.content });
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
    const reusable = findReusableUntitledTab(tabsRef.current);
    if (reusable) {
      if (reusable.id !== activeTabIdRef.current) activateTab(reusable.id);
      setMode("code");
      return;
    }
    snapshotActiveTab();
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
      const bytes = new TextEncoder().encode(tutorialContent).length;
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
        content: tutorialContent,
        originalContent: tutorialContent,
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
      setContent(tutorialContent);
      setOriginalContent(tutorialContent);
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
      knownMtimeRef.current = await invoke<number>("save_file", { path: selected, content });
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
    if (conflictPrompt) return;
    try {
      knownMtimeRef.current = await invoke<number>("save_file", { path: filePath, content });
      setOriginalContent(content);
      showToast("File saved", "success");
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || "Failed to save file", "error");
    }
  }, [conflictPrompt, content, filePath, handleSaveAs, showToast]);

  // External-change detection: on window focus, stat the open file and reload
  // a clean buffer or prompt for a dirty buffer. EXT-01. Callbacks are memoised
  // so the focus listener stays registered across renders.
  const handleExternalReloaded = useCallback(
    () => showToast("File changed on disk, reloaded the latest version", "info"),
    [showToast],
  );
  const handleExternalConflict = useCallback(
    () => setConflictPrompt({ fileName: liveRef.current.fileName ?? "Untitled.md" }),
    [],
  );
  // Resolution for the disk-conflict dialog. "Keep mine" changes nothing on
  // disk: the watcher already absorbed the new mtime, so the next save (manual
  // or autosave) deliberately overwrites the external version. "Load from disk"
  // reuses the watcher's reload path, which resets content/originalContent and
  // the known mtime. EXT-02.
  const handleConflictKeepMine = useCallback(() => setConflictPrompt(null), []);
  const handleConflictLoadFromDisk = useCallback(() => {
    const path = filePathRef.current;
    setConflictPrompt(null);
    if (path) void loadFileDirect(path);
  }, [loadFileDirect]);
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
  // asking about. EXT-02.
  const handleAutosaved = useCallback((mtime: number, saved: string) => {
    knownMtimeRef.current = mtime;
    setOriginalContent(saved);
  }, []);
  const handleAutosaveError = useCallback((message: string) => showToast(message, "error"), [showToast]);
  useAutosave({
    enabled: autoSaveEnabled,
    filePath,
    content,
    originalContent,
    isReviewActive,
    conflictPending: conflictPrompt != null,
    onSaved: handleAutosaved,
    onError: handleAutosaveError,
  });

  // Autosave dirty BACKGROUND tabs too (useAutosave above covers the active
  // buffer). Background snapshots change only when switching away, so this
  // effect keys on `tabs` and settles after saved snapshots are updated. TABS-06.
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const activeId = activeTabIdRef.current;
    const dirtyBackgroundTabs = tabs.filter(
      (tab) => tab.id !== activeId && tab.filePath && tab.content !== tab.originalContent,
    );
    if (dirtyBackgroundTabs.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (const tab of dirtyBackgroundTabs) {
        try {
          const mtime = await invoke<number>("save_file", { path: tab.filePath!, content: tab.content });
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
  }, [autoSaveEnabled, commitTabs, tabs]);

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
            const fileData = await invoke<FileData>("read_file", { path: tab.filePath! });
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
            commitTabs(
              tabsRef.current.map((current) =>
                current.id === tab.id ? { ...current, knownMtime: info.modified } : current,
              ),
            );
            showToast(
              `"${tab.fileName}" changed on disk in a background tab. Saving it will overwrite those changes.`,
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
      if (paths.length === 0) {
        setBooting(false);
        return;
      }
      // Read each file, skipping stale entries. Always surface a forced-open
      // file's failure (CLI arg or Android intent) — the user explicitly
      // requested it from outside the app.
      const loaded: TabState[] = [];
      let activeId: string | null = null;
      for (const path of paths) {
        try {
          const fileData = await invoke<FileData>("read_file", { path });
          const id = newTabId();
          loaded.push({
            id,
            filePath: fileData.path,
            fileName: fileData.name,
            content: fileData.content,
            originalContent: fileData.content,
            fileSize: fileData.size,
            knownMtime: fileData.modified ?? 0,
            cursorLine: cursorByPath.get(path),
          });
          if (path === activePath) activeId = id;
        } catch (error) {
          const message = errMessage(error);
          if (forcedFile && path === forcedFile) showToast(`Could not open file: ${message || path}`, "error");
          else if (/too large/i.test(message)) showToast(`Could not restore "${path}": ${message}`, "error");
        }
      }
      if (loaded.length === 0) {
        setSession(null);
        setLastFile(null);
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
      setOriginalContent(activeTab.content);
      setFileSize(activeTab.fileSize);
      knownMtimeRef.current = activeTab.knownMtime;
      addRecentFile(activeTab.filePath!, activeTab.fileName);
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

  return {
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
