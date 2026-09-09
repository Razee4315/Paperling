import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, ask } from "@tauri-apps/plugin-dialog";
import { listen, TauriEvent } from "@tauri-apps/api/event";

import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { ThemeProvider, useTheme, type Theme } from "./context/ThemeContext";
import { TitleBar } from "./components/TitleBar";
import { MobileTopBar, MobileMenu } from "./components/MobileTopBar";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { SaveAsNameModal, type SaveAsChoice } from "./components/SaveAsNameModal";
import { ZenTopBar } from "./components/ZenTopBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { CodeEditor } from "./components/CodeEditor";
import { StatusBar } from "./components/StatusBar";
import { ModeToggle, type ViewMode } from "./components/ModeToggle";
import { ToastStack } from "./components/Toast";
import { SplitDivider } from "./components/SplitDivider";
import { type PaletteCommand } from "./components/CommandPalette";
import { useToast } from "./hooks/useToast";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { formatShortcut } from "./config/keybindings";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { usePersistedState } from "./hooks/usePersistedState";
import { useFullscreen } from "./hooks/useFullscreen";
import { useScrollSync } from "./hooks/useScrollSync";
import { useFileSession } from "./hooks/useFileSession";
import { useKeyboardInset } from "./hooks/useKeyboardInset";
import { IS_MOBILE, isTauri } from "./utils/platform";
import { joinNotesPath } from "./utils/mobileFiles";
import { openSystemFilePicker, saveToDownloads, DOWNLOADS_SENTINEL } from "./utils/nativePicker";
import { normalizeMarkdownFileName } from "./utils/mobileFiles";

// === Lazy-loaded screens / dialogs ===
//
// Cold-start budget: the welcome screen is what the user sees first, and it
// doesn't need react-markdown, the export module, the settings modal, the
// command palette, or any sidebar panel to render. Importing them eagerly meant
// 300 kB+ of JS had to parse before the welcome screen could paint. Each of
// these is now its own chunk, fetched only when its surface is mounted.
//
// React.lazy expects a default export; our components are named exports, so
// we adapt with the `.then(m => ({ default: m.X }))` shim.
const MarkdownPreview = lazy(() =>
    import("./components/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview }))
);
const FileExplorer = lazy(() =>
    import("./components/FileExplorer").then((m) => ({ default: m.FileExplorer }))
);
const TableOfContents = lazy(() =>
    import("./components/TableOfContents").then((m) => ({ default: m.TableOfContents }))
);
const BacklinksPanel = lazy(() =>
    import("./components/BacklinksPanel").then((m) => ({ default: m.BacklinksPanel }))
);
const SettingsModal = lazy(() =>
    import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal }))
);
const StatsDialog = lazy(() =>
    import("./components/StatsDialog").then((m) => ({ default: m.StatsDialog }))
);
const CommandPalette = lazy(() =>
    import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette }))
);
const GlobalSearch = lazy(() =>
    import("./components/GlobalSearch").then((m) => ({ default: m.GlobalSearch }))
);
const ShortcutCheatsheet = lazy(() =>
    import("./components/ShortcutCheatsheet").then((m) => ({ default: m.ShortcutCheatsheet }))
);
const UnsavedChangesDialog = lazy(() =>
    import("./components/UnsavedChangesDialog").then((m) => ({ default: m.UnsavedChangesDialog }))
);
const AIPanel = lazy(() =>
    import("./components/AIPanel").then((m) => ({ default: m.AIPanel }))
);
// Update popup — mounts on every launch, renders nothing unless a newer
// signed release is found on GitHub (and the user hasn't skipped it).
const UpdateDialog = lazy(() =>
    import("./components/UpdateDialog").then((m) => ({ default: m.UpdateDialog }))
);
import { getRecentFiles } from "./utils/persistence";
import {
  getAIConfig,
  getAIEnabled,
  getAIPanelWidth,
  initAIKey,
  getSavedViewMode,
  getSpellCheck,
  getSplitRatio,
  getToolbarEnabled,
  getTourDone,
  getTypewriterMode,
  getWordWrap,
  setAIEnabled,
  setSavedViewMode,
  setSpellCheck,
  setSplitRatio,
  setToolbarEnabled,
  setTourDone,
  setTypewriterMode,
  setWordWrap,
  getZenMode,
  setZenMode,
} from "./utils/persistence";
import { getAutoSave } from "./utils/persistence";
import { resolveRelativePath } from "./utils/resolveRelativePath";
import { errMessage } from "./utils/errors";
import { revealMainWindow, desktopWindow } from "./utils/appWindow";
import { TabBar, type TabBarItem } from "./components/TabBar";
import { TabContextMenu } from "./components/TabContextMenu";
import {
  computeTabLabels,
} from "./utils/tabsModel";
import { countSourceWords, countWords } from "./utils/documentStats";
import { Tour } from "./components/Tour";
import { FindBar } from "./components/FindBar";
import { createPreviewFindController } from "./utils/previewFind";
// The interactive feature guide, shipped as raw markdown so it opens as a real,
// editable document (offered at the end of the welcome tour / from the palette).
import tutorialMarkdown from "./assets/tutorial.md?raw";

// Platform-aware AI shortcut hint. Windows uses Alt+J because WebView2 reserves
// Ctrl+J for its Downloads UI before the page sees it; macOS shows ⌘J. (AI-02.)
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const AI_SHORTCUT = IS_MAC ? "⌘J" : "Alt+J";

// The AI panel's width is a persisted user setting, dragged from its left edge
// (#111). App owns it because three things must agree on one number: the panel
// itself, the padding-right the editor/preview reserves so content reflows
// beside it (not under it), and the floating mode toggle that sits clear of it.

// Width of the left-side drawers (FileExplorer / TableOfContents); they are
// `fixed left-0 w-72` (18rem = 288px), so the editor reserves this much
// padding-left when one is open so content reflows beside it (not under it).
const SIDEBAR_WIDTH = 288;

// Theme options for the command palette, in the same order as Settings.
const THEME_CHOICES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "paper", label: "Paper" },
  { id: "dracula", label: "Dracula" },
];

function AppContent() {
  const { theme, setTheme, font, fontSize, customFont } = useTheme();

  // Publishes --keyboard-inset (the on-screen keyboard's height) and keeps
  // focused fields visible. Desktop-safe: without a visualViewport the hook
  // is a no-op.
  useKeyboardInset();

  // UI state
  const [mode, setMode] = usePersistedState<ViewMode>(getSavedViewMode, setSavedViewMode);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [splitRatio, setSplitRatioState] = usePersistedState<number>(getSplitRatio, setSplitRatio);
  const [aiConfig, setAiConfigState] = useState(() => getAIConfig());
  const [aiEnabled, setAiEnabledState] = usePersistedState<boolean>(getAIEnabled, setAIEnabled);
  const [typewriterModeEnabled, setTypewriterModeEnabled] = usePersistedState<boolean>(getTypewriterMode, setTypewriterMode);
  const [toolbarVisible, setToolbarVisible] = usePersistedState<boolean>(getToolbarEnabled, setToolbarEnabled);
  const [wordWrapEnabled, setWordWrapEnabled] = usePersistedState<boolean>(getWordWrap, setWordWrap);
  const [zenMode, setZenModeState] = usePersistedState<boolean>(getZenMode, setZenMode);
  // Live mirrors for the mount-once Settings event listener below, so the
  // Settings toggle routes through the same toggle (with view-mode
  // park/restore) as F9 instead of flipping the bare flag. ZEN-01.
  const zenModeRef = useRef(zenMode);
  zenModeRef.current = zenMode;
  const zenToggleRef = useRef<() => void>(() => {});
  const [spellCheckEnabled, setSpellCheckEnabled] = usePersistedState<boolean>(getSpellCheck, setSpellCheck);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  // Editor selection range. Collapsed (start === end) means no selection;
  // when start < end we surface a "N words selected" chip in the status bar.
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  // Unsaved-changes dialog for window close (Alt+F4, taskbar close, the title
  // bar X). The Tauri close-requested handler below intercepts ALL of them.
  const [showUnsavedBeforeClose, setShowUnsavedBeforeClose] = useState(false);
  // Find bar over the reader-mode preview (Ctrl+F when mode === "preview").
  const [previewFindOpen, setPreviewFindOpen] = useState(false);
  // Autosave: save a moment after the user stops typing (Settings → Editor).
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => getAutoSave());

  // Sidebar panel state
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  // Live during a drag; the panel writes the settled value to storage itself.
  const [aiPanelWidth, setAiPanelWidth] = useState(getAIPanelWidth);
  // Proposed document from Agent mode, shown as an inline diff for accept/reject.
  const [proposedDoc, setProposedDoc] = useState<string | null>(null);

  // Preview scroll position
  const [previewLine, setPreviewLine] = useState(1);

  // Toast notifications (state + show/hide helpers live in a hook).
  const { toasts, showToast, dismissToast } = useToast();

  // ===== Mobile shell state =====
  // The app-private notes root (Android scoped storage: OS-picked files are
  // SAF URIs the Rust file commands can't read, so the phone works inside this
  // one folder). Resolved once at boot; the FileExplorer falls back to it and
  // mobile Save-As writes into it.
  const [notesDir, setNotesDir] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Pending mobile save-as: the modal fills the name, then resolves the
  // waiting promptForSavePath caller with a full notes-dir path (or null).
  const [saveAsRequest, setSaveAsRequest] = useState<{
    defaultName: string | null;
    resolve: (path: string | null) => void;
  } | null>(null);

  // Close all panels. Defined early: the Android open-file bridge (below)
  // puts the sheets away when a note arrives from outside the app.
  const closeAllPanels = useCallback(() => {
    setShowFileExplorer(false);
    setShowTOC(false);
    setShowBacklinks(false);
  }, []);

  // Settings close shared by the modal's own onClose and the back handler —
  // both must pick up AI endpoint/key edits made while it was open.
  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setAiConfigState(getAIConfig());
  }, []);

  useEffect(() => {
    // Only meaningful inside Tauri (the command doesn't exist in a plain
    // browser, and its failure toast would just be noise on the ?mobile=1
    // testing path).
    if (!IS_MOBILE || !isTauri()) return;
    let cancelled = false;
    invoke<{ path: string }>("get_notes_dir")
      .then((dir) => {
        if (!cancelled) setNotesDir(dir.path);
      })
      .catch((err) => {
        console.error("Could not resolve the notes folder:", err);
        showToast(errMessage(err) || "Could not open the notes folder", "error");
      });
    return () => {
      cancelled = true;
    };
    // Mount-only: the notes root never changes for the life of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Split view is a desktop luxury: two panes cannot share a 360px screen.
  // A persisted "split" (e.g. from a ?mobile=1 session) collapses to code.
  useEffect(() => {
    if (IS_MOBILE && mode === "split") setMode("code");
  }, [mode, setMode]);

  // Mobile Save-As: name → notes path (with an overwrite confirm). The modal
  // below drives the resolver; see useFileSession's promptSavePath option.
  const mobilePromptSavePath = useCallback(
    (defaultName: string | null): Promise<string | null> =>
      new Promise((resolve) => setSaveAsRequest({ defaultName, resolve })),
    [],
  );

  const handleSaveAsConfirm = useCallback(
    async (choice: SaveAsChoice | null) => {
      const req = saveAsRequest;
      setSaveAsRequest(null);
      if (!req || !choice) {
        req?.resolve(null);
        return;
      }
      if (choice.destination === "downloads") {
        // useFileSession owns the note content and performs the native
        // MediaStore write; the sentinel just reports the chosen destination.
        req.resolve(DOWNLOADS_SENTINEL);
        return;
      }
      if (!notesDir) {
        req.resolve(null);
        return;
      }
      const path = joinNotesPath(notesDir, choice.name);
      if (!path) {
        req.resolve(null);
        return;
      }
      // get_file_info throws when the target is free; only an existing note
      // needs the replace confirmation.
      try {
        await invoke("get_file_info", { path });
        const ok = await ask(`"${choice.name}" already exists. Replace it?`, {
          title: "Replace note",
          kind: "warning",
        });
        if (!ok) {
          req.resolve(null);
          return;
        }
      } catch {
        /* doesn't exist — nothing to confirm */
      }
      req.resolve(path);
    },
    [saveAsRequest, notesDir],
  );

  // One save-location strategy for every path that needs one (manual Save As,
  // close-tab save, close-window save): OS panel on desktop, name prompt on
  // mobile. Same contract: resolve a full path, or null to cancel.
  const promptForSavePath = useCallback(
    (defaultName: string | null): Promise<string | null> => {
      if (IS_MOBILE) return mobilePromptSavePath(defaultName);
      return save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: defaultName ?? undefined,
      }).then((selected) => (typeof selected === "string" ? selected : null));
    },
    [mobilePromptSavePath],
  );

  // On the phone there is no OS open panel (and its SAF result would be
  // unreadable anyway) — "open" means the in-app files browser. That action
  // lives right after useFileSession below (it needs the hook's handleOpenFile).

  // File state and the complete open/save/new/tab lifecycle live behind one
  // typed boundary. UI-only state remains in App; switching documents clears
  // any review because a proposal belongs to the file it was created for.
  const clearReview = useCallback(() => setProposedDoc(null), []);
  const {
    filePath,
    fileName,
    content,
    setContent,
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
  } = useFileSession({
    currentLine: mode === "preview" ? previewLine : cursorPosition.line,
    autoSaveEnabled,
    isReviewActive: proposedDoc != null,
    clearReview,
    setMode,
    showToast,
    promptSavePath: promptForSavePath,
  });

  // On the phone there is no OS open panel (and its SAF result would be
  // unreadable anyway) — "open" means the in-app files browser, rooted at the
  // notes folder or the current file's directory.
  const handleOpenFileAction = useCallback(() => {
    if (IS_MOBILE) {
      setShowFileExplorer(true);
      setShowTOC(false);
      setShowBacklinks(false);
      return;
    }
    handleOpenFile();
  }, [handleOpenFile]);

  // Android "Open with Paperling": the patched MainActivity copies the picked
  // file into app-private storage and calls window.__paperlingOpenFile(path,
  // name) (defined inline in index.html). This effect is the app half of that
  // bridge: register the real opener and pick up anything that arrived before
  // mount. Re-runs are harmless — the native side fires once per intent, and
  // loadFile dedupes by tab path.
  useEffect(() => {
    if (!IS_MOBILE || !isTauri()) return;
    const bridge = window as unknown as {
      __paperlingPendingOpen?: { path: string; name?: string };
      __paperlingOnOpenFile?: (p: { path: string; name?: string }) => void;
    };
    bridge.__paperlingOnOpenFile = (p) => {
      if (!p?.path) return;
      void loadFile(p.path);
      // Both native open paths (Open-with intents and the system document
      // picker) fire while the files sheet may be covering the screen; the
      // freshly opened note must be visible, so put the sheets away.
      closeAllPanels();
    };
    const pending = bridge.__paperlingPendingOpen;
    if (pending?.path) {
      bridge.__paperlingPendingOpen = undefined;
      void loadFile(pending.path);
    }
  }, [loadFile, closeAllPanels]);

  // Export HTML content ref - captures from visible preview
  const previewRef = useRef<HTMLDivElement>(null);
  // Reader-mode adapter for the shared FindBar. Stable identity (reads previewRef
  // at call time) so the bar's effects don't churn.
  const previewFindController = useMemo(() => createPreviewFindController(previewRef), []);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Bidirectional scroll sync between editor and preview (split mode only).
  const { registerCodeScroller, registerPreviewScroller, onCodeScrollFraction, onPreviewScrollFraction } =
    useScrollSync(mode);

  // Reader-mode find only makes sense over the preview; close it (and drop
  // its highlights) when the user switches to code or split.
  useEffect(() => {
    if (mode !== "preview") setPreviewFindOpen(false);
  }, [mode]);

  // Reveal the window once the tree has mounted and painted the themed
  // background. The window is created hidden (visible:false) so the webview's
  // white pre-load surface never reaches the screen (#98). A failsafe timeout in
  // main.tsx and a fallback in the ErrorBoundary guarantee it still shows even
  // if a crash stops this effect from running.
  useEffect(() => {
    revealMainWindow();
  }, []);

  // Keep the native window title (taskbar / Alt-Tab) in step with the active
  // file and its dirty state, so two Paperling windows are distinguishable and
  // a leading bullet flags unsaved work. Keyed on the dirty BOOLEAN (not raw
  // content) so it doesn't fire an IPC call on every keystroke. TITLE-01.
  useEffect(() => {
    const title = fileName ? `${isDirty ? "• " : ""}${fileName} - Paperling` : "Paperling";
    // desktopWindow() (not Window.getCurrent()) — the latter reads
    // __TAURI_INTERNALS__ eagerly and throws in a plain browser, which would
    // crash the whole app at boot in browser dev mode.
    desktopWindow()?.setTitle(title).catch(() => {/* browser dev mode */});
  }, [fileName, isDirty]);

  // First-run welcome tour: auto-start the first time a buffer is on screen.
  // The tour anchors to elements (mode toggle, editor panes) that only exist
  // once a file is open, so it can't run over the WelcomeScreen. Mobile skips
  // it entirely — it spotlights desktop chrome (title bar buttons, F11) that
  // doesn't exist on the phone shell, and its card overflowed narrow screens.
  useEffect(() => {
    if (hasFile && !booting && !getTourDone() && !IS_MOBILE) setShowTour(true);
  }, [hasFile, booting]);

  const handleCloseTour = useCallback(() => {
    setTourDone(true);
    setShowTour(false);
  }, []);

  // PERF: Typing in the editor calls setContent on every keystroke, which would
  // synchronously re-render every consumer of `content` — including the markdown
  // preview, which runs remark-gfm + rehype-highlight + react-markdown over the
  // entire document. On a few-hundred-line file that's 50-200ms of work and the
  // textarea feels laggy because React can't commit the new value until the tree
  // is reconciled.
  //
  // We debounce the value passed to those heavy consumers by ~80ms — short
  // enough to feel real-time during a normal pause between keystrokes, long
  // enough that fast typing skips many intermediate re-renders. The editor
  // itself still uses live `content` so the glyph you typed appears immediately.
  // (We previously used useDeferredValue here, but under React StrictMode + the
  // bursty state churn at file-open it could starve and leave the preview
  // showing the empty initial value.)
  // Scale the debounce with document size: tiny docs feel instant at 80ms, but a
  // multi-thousand-line doc benefits from coalescing more keystrokes before the
  // (still heavy) full re-parse fires. Combined with the preview's startTransition
  // render, this keeps typing responsive on large files. PREVIEW-01.
  const previewDebounceMs = content.length > 40_000 ? 250 : content.length > 12_000 ? 160 : 80;
  const deferredContent = useDebouncedValue(content, previewDebounceMs);

  // Word/char counts feed the status bar — fine to lag a frame behind on huge
  // docs, so they read deferred too. countSourceWords is the SAME pipeline the
  // stats dialog uses (strips frontmatter/code, ignores markdown syntax), so
  // the status bar and the dialog always agree. STATS-01.
  const wordCount = useMemo(() => countSourceWords(deferredContent), [deferredContent]);
  const charCount = deferredContent.length;
  // Selection word count, when the user has a non-empty range highlighted.
  // Reads LIVE `content` (not deferredContent) since the selection range and
  // the underlying text must agree — sliding by 80ms would briefly count words
  // from a stale buffer right after a fast edit. The slice is cheap regardless.
  // Uses countWords (no frontmatter/code stripping): a selection inside a code
  // block should still report what's selected.
  const selectionLength = selectionRange.end - selectionRange.start;
  const selectionWordCount = useMemo(
    () => (selectionLength > 0 ? countWords(content.slice(selectionRange.start, selectionRange.end)) : 0),
    [content, selectionRange.start, selectionRange.end, selectionLength]
  );
  // Average adult reading speed for prose: ~200 wpm.
  const readingTimeMin = useMemo(() => wordCount / 200, [wordCount]);

  // Settings flags above persist themselves via usePersistedState; the matching
  // setters (setSavedViewMode, setSplitRatio, …) are passed into that hook.

  // Cross-component event listeners — settings menu and command palette toggle these
  useEffect(() => {
    const handlers: Array<[string, (e: Event) => void]> = [
      ["paperling:typewriter-toggle", (e) => setTypewriterModeEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:toolbar-toggle", (e) => setToolbarVisible(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:wordwrap-toggle", (e) => setWordWrapEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:spellcheck-toggle", (e) => setSpellCheckEnabled(!!(e as CustomEvent).detail?.enabled)],
      // Settings → Editor toggle for Zen mode. Routed through the shared
      // toggle (a no-op when already in the desired state) so entering via
      // Settings parks/restores the view mode exactly like F9 does. ZEN-01.
      ["paperling:zen-toggle", (e) => {
        if (!!(e as CustomEvent).detail?.enabled !== zenModeRef.current) zenToggleRef.current();
      }],
      ["paperling:autosave-toggle", (e) => setAutoSaveEnabled(!!(e as CustomEvent).detail?.enabled)],
      // Opened from the title-bar settings dropdown's "More settings…" entry.
      ["paperling:open-settings", () => setShowSettings(true)],
      // Alt+J with no selection opens the docked AI side panel. The editor's
      // ai-assist handler decides bubble (selection) vs panel (no selection).
      // Reads the persisted flag live (this effect mounts once) so the panel
      // can't be opened while AI is switched off in Settings.
      ["paperling:toggle-ai-panel", () => { if (getAIEnabled()) setShowAIPanel((v) => !v); }],
      // Settings master switch for all AI surfaces; closing the panel here
      // keeps it from lingering open after AI is turned off.
      ["paperling:ai-enabled-toggle", (e) => {
        const enabled = !!(e as CustomEvent).detail?.enabled;
        setAiEnabledState(enabled);
        if (!enabled) setShowAIPanel(false);
      }],
    ];
    handlers.forEach(([k, h]) => window.addEventListener(k, h));

    // Note: there used to be a `storage` event listener here that re-read the
    // AI config. It was dead code — the spec only fires `storage` events on
    // OTHER documents/tabs that mutate localStorage, never on the writing
    // document. The actual refresh path is the explicit `setAiConfigState(
    // getAIConfig())` call in SettingsModal's onClose, which works correctly.

    return () => {
      handlers.forEach(([k, h]) => window.removeEventListener(k, h));
    };
  }, []);

  // Prefetch the heaviest lazy chunks during browser idle so the first time
  // the user actually opens a file or a sidebar, the bundle is already in
  // cache. Without this we'd block the file-open click on a network fetch
  // for ~340 kB of react-markdown. The prefetch is fire-and-forget; if the
  // user never opens a file before closing the app, no harm done.
  useEffect(() => {
    type IdleApi = (cb: () => void, opts?: { timeout?: number }) => number;
    const ric: IdleApi = (typeof window !== "undefined" && (window as unknown as { requestIdleCallback?: IdleApi }).requestIdleCallback)
        ? (window as unknown as { requestIdleCallback: IdleApi }).requestIdleCallback
        : ((cb) => window.setTimeout(cb, 600) as unknown as number);
    const id = ric(() => {
      // Markdown rendering pipeline is the single biggest deferred chunk;
      // pull it in the moment the welcome screen has settled. The other
      // dialogs are tiny and aren't worth racing the network for.
      import("./components/MarkdownPreview").catch(() => {/* offline / cancelled */ });
    }, { timeout: 1500 });
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (cancel) cancel(id);
      else window.clearTimeout(id);
    };
  }, []);

  // Hydrate the AI API key from the OS keychain on launch, then refresh the
  // config so the editor's AI bubble has the key ready. SECURITY-01.
  useEffect(() => {
    initAIKey().then(() => setAiConfigState(getAIConfig()));
  }, []);

  // Intercept EVERY window-close path (Alt+F4, taskbar close, the title bar X,
  // OS shutdown) and route dirty buffers through the unsaved-changes dialog.
  // Previously only the custom X button checked isDirty, so Alt+F4 silently
  // discarded unsaved work. The title bar X calls Window.close(), which also
  // fires this event — one interception point for all of them. CLOSE-01.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    const win = desktopWindow();
    if (win) {
      win
        .onCloseRequested((event) => {
          // Guard ALL tabs, not just the active one — a dirty background tab used
          // to be discarded silently on Alt+F4 / taskbar close. TABS-04.
          if (collectDirtyTabs().length > 0) {
            event.preventDefault();
            setShowUnsavedBeforeClose(true);
          }
        })
        .then((fn) => {
          if (mounted) unlisten = fn;
          else fn();
        })
        .catch(() => {/* browser dev mode — no Tauri window */});
    }
    return () => {
      mounted = false;
      unlisten?.();
    };
    // Registered once; collectDirtyTabs is stable (reads refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close-dialog handlers. destroy() skips the close-requested event, so we
  // don't loop back into the dialog we just answered. Mobile has no window to
  // destroy — window controls are OS chrome there and the capability is
  // intentionally absent — so the explicit save/discard outcome exits through
  // the exit_app command instead. Without it a back-press with unsaved work
  // could trap the user in the dialog forever.
  const forceCloseWindow = useCallback(() => {
    if (IS_MOBILE) {
      invoke("exit_app").catch(() => {/* nothing left to fall back to */});
      return;
    }
    desktopWindow()?.destroy().catch(() => {/* browser dev mode */});
  }, []);

  // Save EVERY dirty tab, then close. An untitled tab prompts for a location;
  // cancelling that (or any failed save) aborts the close so nothing is lost. TABS-04.
  const handleSaveAndCloseWindow = useCallback(async () => {
    setShowUnsavedBeforeClose(false);
    for (const t of collectDirtyTabs()) {
      let path = t.filePath;
      if (!path) {
        const selected = await promptForSavePath(t.fileName);
        if (!selected) return; // cancelled a save-as → keep the app open
        path = selected;
      }
      if (path === DOWNLOADS_SENTINEL) {
        const cachePath = await saveToDownloads(normalizeMarkdownFileName(t.fileName), t.content);
        if (!cachePath.ok || !cachePath.path) {
          showToast(cachePath.error || `Could not save ${t.fileName} to Downloads`, "error");
          return;
        }
        path = cachePath.path;
      }
      try {
        await invoke("save_file", { path, content: t.content });
      } catch (err) {
        const msg = errMessage(err);
        showToast(msg || `Failed to save ${t.fileName}`, "error");
        return; // don't close on a failed save — the user would lose the buffer
      }
    }
    forceCloseWindow();
  }, [collectDirtyTabs, forceCloseWindow, promptForSavePath, showToast]);

  const handleDiscardAndCloseWindow = useCallback(() => {
    setShowUnsavedBeforeClose(false);
    forceCloseWindow();
  }, [forceCloseWindow]);

  // Listen for Tauri drag-drop events
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<{ paths: string[] }>(TauriEvent.DRAG_DROP, async (event) => {
      // Open EVERY dropped markdown / text file in its own tab (the last one
      // wins focus), rather than only the first. TABS-11 / TXT-01.
      const paths = (event.payload.paths ?? []).filter((p) =>
        /\.(md|markdown|txt|text)$/i.test(p)
      );
      for (const p of paths) {
        await loadFile(p);
      }
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn(); // Component already unmounted, clean up immediately
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [loadFile]);

  // Offer to create a note that a link points at but doesn't exist yet, then
  // open it. Used by both wikilinks and relative links. NAV-07.
  const offerCreateNote = useCallback(async (path: string, displayName: string) => {
    const confirmed = await ask(`"${displayName}" doesn't exist yet. Create it?`, {
      title: "Create note",
      kind: "info",
    });
    if (!confirmed) return;
    try {
      await invoke<number>("save_file", { path, content: "" });
      await loadFile(path);
    } catch (err) {
      const msg = errMessage(err);
      showToast(msg || "Could not create note", "error");
    }
  }, [loadFile, showToast]);

  // Wikilink click: resolve target relative to the current file's folder.
  // Tries `<target>.md` first, then `<target>` literal. Silently fails if neither exists.
  // SECURITY: rejects path-traversal and absolute paths so a crafted document
  // can't load arbitrary files outside the current folder.
  const handleWikilinkClick = useCallback(async (target: string) => {
    if (!filePath) return;
    const cleaned = target.trim();
    // Block traversal (`..`), path separators, drive letters, and absolute paths.
    // Wikilinks should only reference siblings in the same folder.
    if (
      !cleaned ||
      cleaned.includes("..") ||
      cleaned.includes("/") ||
      cleaned.includes("\\") ||
      cleaned.includes("\0") ||
      /^[a-zA-Z]:/.test(cleaned)
    ) {
      showToast(`Invalid wikilink target: [[${target}]]`, "error");
      return;
    }
    const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    const dir = lastSep > 0 ? filePath.slice(0, lastSep) : "";
    const sep = filePath.includes("\\") ? "\\" : "/";
    const candidates = [
      `${dir}${sep}${cleaned}.md`,
      `${dir}${sep}${cleaned}.markdown`,
      `${dir}${sep}${cleaned}`,
    ];
    for (const c of candidates) {
      try {
        // get_file_info errors when the file doesn't exist; use it as a probe
        await invoke("get_file_info", { path: c });
        loadFile(c);
        return;
      } catch {/* try next */}
    }
    // Nothing matched — offer to create the note next to the current file, the
    // way Obsidian turns a dangling [[link]] into a new file. NAV-07.
    offerCreateNote(`${dir}${sep}${cleaned}.md`, `${cleaned}.md`);
  }, [filePath, loadFile, showToast, offerCreateNote]);

  // Standard relative markdown links — `[text](note.md)`, `[x](sub/note.md)`,
  // `[y](../other.md)` — open in-app like wikilinks (the preview only routes
  // local .md/.markdown hrefs here). Resolve against the current file's folder,
  // normalising `.`/`..` segments. A missing file surfaces via loadFile. NAV-05.
  const handleNavigateRelative = useCallback(async (href: string) => {
    if (!filePath) return;
    const resolved = resolveRelativePath(filePath, href);
    if (!resolved) return;
    try {
      // Probe first so a link to a not-yet-created note offers creation rather
      // than flashing a "failed to open" error. NAV-07.
      await invoke("get_file_info", { path: resolved });
      loadFile(resolved);
    } catch {
      const name = resolved.replace(/\\/g, "/").split("/").pop() || resolved;
      offerCreateNote(resolved, name);
    }
  }, [filePath, loadFile, offerCreateNote]);

  // Open a cross-file search result: load the file (if not already open) and
  // jump to the matching line once it has rendered. The goto-line event is the
  // same one the TOC/palette use, so it lands correctly in any view mode. SEARCH-01.
  const handleOpenSearchResult = useCallback(async (path: string, line: number) => {
    // Wait for the file to actually load before jumping, instead of racing a
    // fixed timeout that a large document could lose (landing at the top). SEARCH-01.
    if (path !== filePath) {
      await loadFile(path);
    }
    requestAnimationFrame(() =>
      window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } }))
    );
  }, [filePath, loadFile]);

  // Folder the cross-file search runs in: the open file's directory.
  const currentDirectory = useMemo(() => {
    if (!filePath) return null;
    const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return lastSep > 0 ? filePath.slice(0, lastSep) : null;
  }, [filePath]);

  const handleOpenTutorial = useCallback(() => openTutorial(tutorialMarkdown), [openTutorial]);

  // "Replay the welcome tour" from Settings → About. The tour spotlights
  // editor chrome, so make sure a buffer exists before showing it. Never on
  // mobile: every spotlight target is desktop-only chrome.
  useEffect(() => {
    const h = () => {
      if (IS_MOBILE) return;
      if (!hasFile) handleNewFile();
      setShowTour(true);
    };
    window.addEventListener("paperling:replay-tour", h);
    return () => window.removeEventListener("paperling:replay-tour", h);
  }, [hasFile, handleNewFile]);

  // Runtime file-open forwards. Cold-start CLI files are handled by the pull
  // in the boot effect above; this event now arrives only from the
  // single-instance plugin, when the user double-clicks another .md while
  // Paperling is already running and the second launch hands us its path.
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<string>("file-open-from-cli", async (event) => {
      const filePath = event.payload;
      if (filePath) {
        await loadFile(filePath);
      }
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [loadFile]);

  // Toggle between preview and code (skips split — split has its own shortcut)
  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === "code" ? "preview" : "code"));
  }, []);

  const handleToggleSplit = useCallback(() => {
    setMode((prev) => (prev === "split" ? "preview" : "split"));
  }, []);

  // Toggle file explorer (mutually exclusive with TOC)
  const handleToggleFileExplorer = useCallback(() => {
    setShowFileExplorer((prev) => !prev);
    setShowTOC(false);
    setShowBacklinks(false);
  }, []);

  // Toggle table of contents (mutually exclusive with file explorer)
  const handleToggleTOC = useCallback(() => {
    setShowTOC((prev) => !prev);
    setShowFileExplorer(false);
    setShowBacklinks(false);
  }, []);

  // Toggle backlinks (mutually exclusive with the other left drawers)
  const handleToggleBacklinks = useCallback(() => {
    setShowBacklinks((prev) => !prev);
    setShowFileExplorer(false);
    setShowTOC(false);
  }, []);

  // Toggle the right-side AI assistant panel.
  const handleToggleAI = useCallback(() => setShowAIPanel((v) => !v), []);

  // Agent proposed an edited document → show it as a diff to accept/reject.
  // Ensure the editor (where the diff renders) is visible.
  const handleProposeEdit = useCallback((doc: string) => {
    setProposedDoc(doc);
    setMode((m) => (m === "preview" ? "split" : m));
  }, []);

  // Review finished: commit the accepted document (or keep the original on reject).
  const handleReviewResolve = useCallback((finalDoc: string | null) => {
    if (finalDoc != null) setContent(finalDoc);
    setProposedDoc(null);
  }, []);

  // ===== Android system back (gesture / button) =====
  // The native side (patched MainActivity) asks __paperlingBack() to close the
  // topmost in-app surface; `true` = consumed, `false` = "nothing left, exit
  // like a normal app". Order mirrors z-order: transient menus and dialogs
  // first, then full modals, then docked panels, then the find bars, and —
  // only when nothing is open — an unsaved-changes guard before exiting.
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = (): boolean => {
    if (tabMenu) { setTabMenu(null); return true; }
    if (saveAsRequest) {
      const req = saveAsRequest;
      setSaveAsRequest(null);
      req.resolve(null);
      return true;
    }
    if (closeTabPrompt) { cancelCloseTab(); return true; }
    if (showUnsavedBeforeClose) { setShowUnsavedBeforeClose(false); return true; }
    if (showTour) { handleCloseTour(); return true; }
    if (menuOpen) { setMenuOpen(false); return true; }
    if (showPalette) { setShowPalette(false); return true; }
    if (showSearch) { setShowSearch(false); return true; }
    if (showSettings) { closeSettings(); return true; }
    if (showStats) { setShowStats(false); return true; }
    if (showCheatsheet) { setShowCheatsheet(false); return true; }
    if (showFileExplorer || showTOC || showBacklinks) { closeAllPanels(); return true; }
    if (showAIPanel) { setShowAIPanel(false); return true; }
    if (previewFindOpen) { setPreviewFindOpen(false); return true; }
    if ((window as { __paperlingEditorFindOpen?: boolean }).__paperlingEditorFindOpen) {
      window.dispatchEvent(new CustomEvent("paperling:close-find"));
      return true;
    }
    // Nothing open: surface unsaved work before the activity goes away.
    if (collectDirtyTabs().length > 0) {
      setShowUnsavedBeforeClose(true);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!IS_MOBILE) return;
    const bridge = window as unknown as { __paperlingBack?: () => boolean };
    bridge.__paperlingBack = () => backRef.current();
    return () => { delete bridge.__paperlingBack; };
  }, []);

  // Zen mode: hide every toolbar and panel, leaving only the canvas. Entering
  // closes the drawers and the AI panel and parks the view in Reader; the
  // pre-zen view mode is restored on exit. Ctrl+E (and the palette view
  // commands) keep working inside zen, so editing stays one keypress away —
  // only the chrome stays hidden. ZEN-01.
  const preZenModeRef = useRef<ViewMode | null>(null);
  const handleToggleZen = useCallback(() => {
    if (!zenMode) {
      preZenModeRef.current = mode;
      closeAllPanels();
      setShowAIPanel(false);
      setPreviewFindOpen(false);
      setMode("preview");
      // Touch has no keyboard to advertise: point at the visible exit chip.
      showToast(IS_MOBILE
        ? "Zen mode — tap Normal up top to go back"
        : `Zen mode — ${formatShortcut("toggleMode")} to edit, ${formatShortcut("zenMode")} to exit`, "info");
    } else {
      const prev = preZenModeRef.current;
      preZenModeRef.current = null;
      if (prev) setMode(prev);
    }
    setZenModeState(!zenMode);
  }, [zenMode, mode, closeAllPanels, showToast, setMode]);
  zenToggleRef.current = handleToggleZen;

  // Effective zen: the flag alone means nothing on the welcome screen (there
  // is no canvas to isolate), so chrome hides only once a file is open.
  const zenActive = zenMode && hasFile;

  // Handle file drop
  const handleFileDrop = useCallback(
    (path: string) => {
      loadFile(path);
    },
    [loadFile]
  );

// Handle content change
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  // Stable cursor + preview-line setters. Critical that these are useCallback
  // (not inline arrows): CodeEditor wires `onCursorChange` into a useEffect via
  // `updateCursorPosition`, and an unstable callback ref would re-run that
  // effect on every parent render, calling `updateCursorPosition()` again,
  // which itself calls `setCursorPosition({ line, col })` with a fresh object
  // — fresh object refs bypass React's bail-out and feed the cycle.
  // The functional-update form bails out (returns the previous state) when the
  // values haven't actually changed, breaking the loop on idle re-renders.
  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursorPosition((prev) => (prev.line === line && prev.col === col ? prev : { line, col }));
  }, []);
  // Bail out via functional update when the range hasn't actually changed —
  // selectionchange fires constantly while typing even when caret is at the
  // same offset, and we don't want to mint a fresh `{ start, end }` object
  // (and trigger a status-bar re-render) on every keystroke.
  const handleSelectionChange = useCallback((start: number, end: number) => {
    setSelectionRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  const handlePreviewLineChange = useCallback((line: number) => {
    setPreviewLine((prev) => (prev === line ? prev : line));
  }, []);

  // Handle image paste success
  const handleImagePaste = useCallback(() => {
    showToast('Image pasted successfully!', 'success');
  }, [showToast]);

  // Handle error messages from child components
  const handleError = useCallback((message: string) => {
    showToast(message, 'error');
  }, [showToast]);

  // Neutral info toast (distinct from error). Used e.g. when AI assist is
  // invoked before it's configured, so the action isn't a silent no-op.
  const handleNotice = useCallback((message: string) => {
    showToast(message, 'info');
  }, [showToast]);

  // Fullscreen (F11). The hook masks the resize behind a fade and works around
  // two Windows frameless-window footguns — see useFullscreen. The "press F11 to
  // exit" hint surfaces as an info toast via handleNotice. FULLSCREEN-01.
  const { isFullscreen, fsTransition, toggleFullscreen } = useFullscreen(handleNotice);

  // Stable export-result callbacks so TitleBar's props are reference-equal
  // across renders. Inline arrows here would re-create the closures on every
  // App render and defeat any downstream memoization.
  const handleExportSuccess = useCallback(
    (fmt: string) => showToast(`Exported as ${fmt}`, "success"),
    [showToast]
  );
  const handleExportError = useCallback(
    (fmt: string) => showToast(`Failed to export ${fmt}`, "error"),
    [showToast]
  );

  // App-wide keyboard shortcuts (window-level, mounted once). See the hook.
  useGlobalShortcuts({
    handleOpenFile, handleSaveFile, handleSaveAs, handleNewFile,
    handleToggleMode, handleToggleSplit, handleToggleFileExplorer, handleToggleTOC,
    toggleFullscreen, toggleZen: handleToggleZen,
    openCheatsheet: () => setShowCheatsheet(true),
    openPalette: () => setShowPalette(true),
    openSettings: () => setShowSettings(true),
    // Ctrl+F in reader mode opens the preview find bar (the editor keymap
    // handles find in code/split mode, where the editor has focus). FIND-01.
    openPreviewFind: () => setPreviewFindOpen(true),
    openSearch: () => setShowSearch(true),
    closeActiveTab: () => { if (activeTabId) closeTab(activeTabId); },
    prevTab: () => cycleTab(-1),
    nextTab: () => cycleTab(1),
    reopenClosedTab,
    gotoTab: gotoTabByIndex,
    hasFile, content, mode,
  });

  // Get export HTML from the visible preview on demand (avoids duplicate rendering)
  const getExportHtml = useCallback((): string => {
    if (previewRef.current) {
      return previewRef.current.innerHTML;
    }
    return "";
  }, []);

  // Mobile "Export as HTML…": the phone's counterpart of the desktop Export
  // menu (there is no OS save panel to aim it at, so the file lands in the
  // user-visible Downloads folder via the native MediaStore bridge). The
  // pipeline is the desktop one verbatim — the preview DOM is captured (it
  // stays mounted with display:none even in code mode) and pushed through
  // prepareExportHtml / generateHTML, lazily imported so the export module
  // stays out of the mobile bundle until first use. This is what makes the
  // welcome note's "export" promise in this menu true. Defined after
  // getExportHtml so the dependency below isn't in its temporal dead zone.
  const handleExportHtml = useCallback(async () => {
    if (!fileName) return;
    const raw = getExportHtml();
    if (!raw) {
      showToast("Nothing to export yet", "error");
      return;
    }
    try {
      const { prepareExportHtml, generateHTML } = await import("./utils/exportUtils");
      const cleaned = await prepareExportHtml(raw);
      const title = fileName.replace(/\.(md|markdown)$/i, "");
      const fullHTML = generateHTML(cleaned, title, theme, font, fontSize, true, customFont);
      const res = await saveToDownloads(`${title}.html`, fullHTML, "text/html");
      if (!res.ok) {
        showToast(res.error || "Could not export HTML", "error");
        return;
      }
      showToast(`Exported "${title}.html" to Downloads`, "success");
    } catch (err) {
      showToast(errMessage(err) || "Could not export HTML", "error");
    }
  }, [fileName, getExportHtml, showToast, theme, font, fontSize, customFont]);

  // Open find / find-and-replace from the Edit menu and command palette. In
  // reader mode "find" uses the preview find bar; "replace" only applies to the
  // editor, so from reader mode we switch to code mode first. The editor listens
  // for these events (CodeEditor's paperling:open-find / paperling:open-replace).
  const openFind = useCallback(() => {
    if (mode === "preview") setPreviewFindOpen(true);
    else window.dispatchEvent(new CustomEvent("paperling:open-find"));
  }, [mode]);
  const openReplace = useCallback(() => {
    if (mode === "preview") {
      setMode("code");
      setTimeout(() => window.dispatchEvent(new CustomEvent("paperling:open-replace")), 0);
    } else {
      window.dispatchEvent(new CustomEvent("paperling:open-replace"));
    }
  }, [mode, setMode]);

  // Build the command palette item list. Rebuilds on relevant state changes —
  // recent files, current file, current view mode, toggles.
  const paletteItems = useMemo<PaletteCommand[]>(() => {
    const items: PaletteCommand[] = [];

    // === File ===
    items.push({
      id: "file.new",
      label: "New file",
      hint: formatShortcut("newFile"),
      section: "File",
      icon: "edit_note",
      run: handleNewFile,
    });
    items.push({
      id: "file.open",
      label: IS_MOBILE ? "Browse notes…" : "Open file…",
      hint: formatShortcut("openFile"),
      section: "File",
      icon: "folder_open",
      run: handleOpenFileAction,
    });
    // Save / Save As only make sense when a buffer is open
    if (hasFile) {
      items.push({
        id: "file.save",
        label: "Save",
        hint: formatShortcut("save"),
        section: "File",
        icon: "save",
        run: handleSaveFile,
      });
      items.push({
        id: "file.saveas",
        label: "Save As…",
        hint: formatShortcut("saveAs"),
        section: "File",
        icon: "save_as",
        run: handleSaveAs,
      });
    }
    if (filePath) {
      // "Reveal in folder" opens the OS file manager — a desktop concept.
      if (!IS_MOBILE) {
        items.push({
          id: "file.reveal",
          label: "Reveal in folder",
          section: "File",
          icon: "folder_open",
          keywords: "show finder explorer locate",
          run: () => {
            revealItemInDir(filePath).catch((err) => {
              console.error("Reveal failed:", err);
              showToast("Could not reveal file", "error");
            });
          },
        });
      }
      items.push({
        id: "file.copypath",
        label: "Copy file path",
        section: "File",
        icon: "content_copy",
        keywords: "clipboard absolute",
        run: () => {
          navigator.clipboard.writeText(filePath).then(
            () => showToast("File path copied", "success"),
            () => showToast("Could not copy path", "error"),
          );
        },
      });
    }
    if (hasFile) {
      items.push({
        id: "doc.stats",
        label: "Show document statistics",
        section: "File",
        icon: "analytics",
        keywords: "words count reading time",
        run: () => setShowStats(true),
      });
      items.push({
        id: "tab.close",
        label: "Close tab",
        hint: formatShortcut("closeTab"),
        section: "File",
        icon: "tab_close",
        keywords: "close current tab",
        run: () => { if (activeTabId) closeTab(activeTabId); },
      });
    }

    // === View === only when a buffer exists
    if (hasFile) {
      items.push({
        id: "view.preview",
        label: "Switch to Reader mode",
        hint: formatShortcut("toggleMode"),
        section: "View",
        icon: "visibility",
        run: () => setMode("preview"),
      });
      items.push({
        id: "view.code",
        label: "Switch to Code editor",
        section: "View",
        icon: "code",
        run: () => setMode("code"),
      });
      items.push({
        id: "view.split",
        label: "Toggle Split view",
        hint: formatShortcut("toggleSplit"),
        section: "View",
        icon: "vertical_split",
        run: handleToggleSplit,
      });
      items.push({
        id: "view.zen",
        label: zenMode ? "Exit Zen mode" : "Enter Zen mode",
        hint: formatShortcut("zenMode"),
        section: "View",
        icon: "self_improvement",
        keywords: "zen distraction free focus minimal reading",
        run: handleToggleZen,
      });
      items.push({
        id: "view.explorer",
        label: "Toggle file explorer",
        hint: formatShortcut("toggleFileExplorer"),
        section: "View",
        icon: "folder",
        run: handleToggleFileExplorer,
      });
      items.push({
        id: "edit.find",
        label: "Find",
        hint: formatShortcut("find"),
        section: "View",
        icon: "search",
        keywords: "find search in document text current file",
        run: openFind,
      });
      items.push({
        id: "edit.replace",
        label: "Find and Replace",
        hint: formatShortcut("replace"),
        section: "View",
        icon: "find_replace",
        keywords: "replace substitute find and swap text",
        run: openReplace,
      });
      items.push({
        id: "search.files",
        label: "Search in files…",
        hint: formatShortcut("searchInFolder"),
        section: "View",
        icon: "search",
        keywords: "find across folder grep global content",
        run: () => setShowSearch(true),
      });
      items.push({
        id: "view.toc",
        label: "Toggle outline",
        hint: formatShortcut("toggleTOC"),
        section: "View",
        icon: "format_list_bulleted",
        run: handleToggleTOC,
      });
      items.push({
        id: "view.backlinks",
        label: "Show backlinks",
        section: "View",
        icon: "link",
        keywords: "links references notes pointing here",
        run: handleToggleBacklinks,
      });
    }

    // Fullscreen works anywhere (including the welcome screen), so unlike the
    // other View entries it isn't gated on a file being open. Mobile has no
    // fullscreen toggle — the app is always immersive.
    if (!IS_MOBILE) {
      items.push({
        id: "view.fullscreen",
        label: "Toggle fullscreen",
        hint: "F11",
        section: "View",
        icon: "fullscreen",
        keywords: "full screen distraction free f11 immersive",
        run: toggleFullscreen,
      });
    }

    // === AI === only when a buffer exists and AI is enabled in Settings.
    // The command palette is the always-reachable entry point for AI assist
    // (the toolbar AI button is hidden when the toolbar is off). Dispatches a
    // window event the editor listens for; if AI isn't configured the editor
    // shows a guiding notice.
    if (hasFile && aiEnabled) {
      items.push({
        id: "ai.assist",
        label: "AI assist on selection",
        hint: AI_SHORTCUT,
        section: "AI",
        icon: "auto_awesome",
        keywords: "ai rewrite shorten expand continue translate assistant gpt llm",
        run: () => window.dispatchEvent(new CustomEvent("paperling:ai-assist")),
      });
    }

    // === Toggles ===
    items.push({
      id: "toggle.typewriter",
      label: typewriterModeEnabled ? "Disable Typewriter mode" : "Enable Typewriter mode",
      section: "Toggles",
      icon: "keyboard",
      keywords: "scroll caret center",
      run: () => setTypewriterModeEnabled((v) => !v),
    });
    // Not offered on mobile: the toolbar is the phone's only formatting
    // surface and is permanently on.
    if (!IS_MOBILE) {
      items.push({
        id: "toggle.toolbar",
        label: toolbarVisible ? "Hide formatting toolbar" : "Show formatting toolbar",
        section: "Toggles",
        icon: "format_paint",
        run: () => setToolbarVisible((v) => !v),
      });
    }

    // === Theme === switch directly from the palette. The welcome tour tells
    // users themes live here, and it makes the four themes discoverable without
    // opening Settings. The active theme is marked and skipped as a no-op.
    for (const t of THEME_CHOICES) {
      items.push({
        id: `theme.${t.id}`,
        label: theme === t.id ? `Theme: ${t.label} (current)` : `Change theme to ${t.label}`,
        section: "Theme",
        icon: "palette",
        keywords: "theme color appearance dark light paper dracula",
        run: () => setTheme(t.id),
      });
    }

    items.push({
      id: "settings.open",
      label: "Open Settings…",
      hint: formatShortcut("settings"),
      section: "Toggles",
      icon: "settings",
      run: () => setShowSettings(true),
    });

    // === Help ===
    // A keyboard-shortcut sheet is meaningless on a touch shell.
    if (!IS_MOBILE) {
      items.push({
        id: "help.cheatsheet",
        label: "Show keyboard shortcuts",
        hint: "?",
        section: "Help",
        icon: "keyboard",
        run: () => setShowCheatsheet(true),
      });
    }
    if (!IS_MOBILE) {
      items.push({
        id: "help.tour",
        label: "Replay the welcome tour",
        section: "Help",
        icon: "tour",
        keywords: "onboarding intro guide help walkthrough",
        run: () => {
          // The tour spotlights editor chrome, so make sure a buffer exists first.
          if (!hasFile) handleNewFile();
          setShowTour(true);
        },
      });
    }
    items.push({
      id: "help.guide",
      label: "Open the interactive guide",
      section: "Help",
      icon: "menu_book",
      keywords: "tutorial guide features demo sample example math diagram mermaid learn",
      run: handleOpenTutorial,
    });

    // === Recent files ===
    const recents = getRecentFiles();
    for (const r of recents) {
      if (r.path === filePath) continue; // current file
      items.push({
        id: `recent.${r.path}`,
        label: r.name,
        hint: r.path,
        section: "Recent files",
        icon: "description",
        keywords: r.path,
        run: () => loadFile(r.path),
      });
    }

    return items;
  }, [
    // NB: deferredContent is intentionally NOT a dep here. Building static
    // file/view/toggle/recent items doesn't depend on the document text, so
    // letting `content` flow into this useMemo would rebuild every keystroke
    // (post-debounce) for no reason. Headings are computed below in a
    // separate hook that's gated on the palette actually being open.
    handleNewFile, handleOpenFileAction, handleSaveFile, handleSaveAs, handleOpenTutorial,
    handleToggleSplit, handleToggleFileExplorer, handleToggleTOC, handleToggleBacklinks, toggleFullscreen,
    loadFile, filePath, hasFile, showToast, closeTab,
    typewriterModeEnabled, toolbarVisible, aiEnabled,
    theme, setTheme, openFind, openReplace, zenMode, handleToggleZen,
  ]);

  // Heading items are recomputed only while the palette is actually open.
  // Scanning every line of the document for `#`-prefixed headings on every
  // typing pause used to be cheap on small docs and noticeable on large
  // ones — and 100 % of that work was discarded if the user wasn't looking
  // at the palette.
  const headingPaletteItems = useMemo<PaletteCommand[]>(() => {
    if (!showPalette || !deferredContent) return [];
    const items: PaletteCommand[] = [];
    const lines = deferredContent.split("\n");
    lines.forEach((line, idx) => {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        const level = m[1].length;
        const text = m[2].trim();
        items.push({
          id: `head.${idx}`,
          label: text,
          hint: `H${level}`,
          section: "Headings",
          icon: level === 1 ? "title" : level === 2 ? "format_h2" : "format_h3",
          keywords: "jump heading",
          run: () => {
            // Jump both panes to the heading's source line. The editor and the
            // preview each listen for this event and scroll themselves (hidden
            // panes scroll harmlessly), so this works in every view mode and
            // lands on the RIGHT heading even when titles repeat. NAV-01.
            window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line: idx + 1 } }));
          },
        });
      }
    });
    return items;
  }, [showPalette, deferredContent]);

  // "Open tabs" palette section — jump to any open tab by name (only worthwhile
  // with more than one open). Uses the same folder disambiguation as the bar. TABS-11.
  const tabPaletteItems = useMemo<PaletteCommand[]>(() => {
    if (tabs.length < 2) return [];
    const resolved = tabs.map((t) => ({
      id: t.id,
      fileName: t.id === activeTabId ? (fileName ?? "Untitled.md") : t.fileName,
      filePath: t.id === activeTabId ? filePath : t.filePath,
    }));
    const labels = computeTabLabels(resolved);
    return tabs.map((t) => ({
      id: `opentab.${t.id}`,
      label: `${labels.get(t.id) ?? t.fileName}${t.id === activeTabId ? " (current)" : ""}`,
      section: "Open tabs",
      icon: "tab",
      keywords: "switch tab open file",
      run: () => activateTab(t.id),
    }));
  }, [tabs, activeTabId, fileName, filePath, activateTab]);

  // Concatenated list passed to the palette. Same `paletteItems` shape as
  // before so the CommandPalette component sees no API change. Reference
  // changes only when one of the sources changes — typically rare.
  const fullPaletteItems = useMemo<PaletteCommand[]>(
    () => [...paletteItems, ...tabPaletteItems, ...headingPaletteItems],
    [paletteItems, tabPaletteItems, headingPaletteItems]
  );

  // Tab-bar items. The active tab's name/dirty come from live state (its stored
  // snapshot lags until the next switch); inactive tabs read their snapshot.
  // `label` disambiguates duplicate file names by folder (TABS-09); `name` is
  // the bare file name (title/aria). Keyed on `isDirty` (a boolean) so typing
  // within an already-dirty file doesn't churn this list. TABS-01.
  const tabBarItems = useMemo<TabBarItem[]>(() => {
    const resolved = tabs.map((t) => {
      const active = t.id === activeTabId;
      return {
        id: t.id,
        fileName: active ? (fileName ?? "Untitled.md") : t.fileName,
        filePath: active ? filePath : t.filePath,
        dirty: active ? isDirty : t.content !== t.originalContent,
      };
    });
    const labels = computeTabLabels(resolved);
    return resolved.map((t) => ({
      id: t.id,
      name: t.fileName,
      label: labels.get(t.id) ?? t.fileName,
      dirty: t.dirty,
    }));
  }, [tabs, activeTabId, fileName, filePath, isDirty]);

  // Right-click menu on a tab: {id, x, y} while open. TABS-12.
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const handleTabContextMenu = useCallback((id: string, x: number, y: number) => {
    setTabMenu({ id, x, y });
  }, []);

  return (
    <div className="app-shell h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden transition-colors">
      {/* Zen mode hides the top chrome on BOTH shells: the desktop title bar
          and the phone's top bar. Above the canvas only the zen top bar
          remains (desktop hover bar / touch "Normal" chip). ZEN-01. */}
      {IS_MOBILE ? (
        !zenActive && (
          <MobileTopBar
            fileName={fileName}
            isDirty={isDirty}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenPalette={() => setShowPalette(true)}
          />
        )
      ) : (
        !zenActive && (
          <TitleBar
            fileName={fileName ?? undefined}
            isDirty={isDirty}
            filePath={filePath ?? undefined}
            onOpenFile={handleOpenFile}
            onNewFile={handleNewFile}
            getExportHtml={getExportHtml}
            onExportSuccess={handleExportSuccess}
            onExportError={handleExportError}
            onToggleAI={aiEnabled ? handleToggleAI : undefined}
            aiActive={showAIPanel}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            onFind={openFind}
            onReplace={openReplace}
            onFindInFiles={() => setShowSearch(true)}
          />
        )
      )}

      {IS_MOBILE && (
        <MobileMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            { id: "new", label: "New note", icon: "note_add", onSelect: handleNewFile },
            { id: "browse", label: "Open notes", icon: "folder_open", onSelect: handleOpenFileAction },
            { id: "open-device", label: "Open from device…", icon: "drive_file_move", dividerBefore: true, onSelect: () => {
                // SAF picker for any .md on the phone (Downloads, Drive…),
                // not just the notes folder the in-app browser can see.
                if (!openSystemFilePicker()) {
                  showToast("System file picker isn't available in this build", "error");
                }
              } },
            ...(hasFile
              ? [
                  { id: "save", label: "Save", icon: "save", onSelect: handleSaveFile },
                  { id: "saveas", label: "Save as…", icon: "save_as", onSelect: handleSaveAs },
                  { id: "export-html", label: "Export as HTML…", icon: "ios_share", onSelect: () => void handleExportHtml() },
                  { id: "find", label: "Find", icon: "search", onSelect: openFind },
                  { id: "replace", label: "Find and replace", icon: "find_replace", onSelect: openReplace },
                  { id: "stats", label: "Document statistics", icon: "analytics", onSelect: () => setShowStats(true) },
                  // The AI panel's touch entry point (there is no nav button
                  // for it; the master switch lives in Settings → AI).
                  ...(aiEnabled
                    ? [{ id: "ai", label: showAIPanel ? "Hide AI assistant" : "AI assistant", icon: "auto_awesome", onSelect: handleToggleAI }]
                    : []),
                ]
              : []),
            ...(filePath
              ? [{ id: "search-files", label: "Search in files…", icon: "manage_search", onSelect: () => setShowSearch(true) }]
              : []),
            {
              id: "settings",
              label: "Settings",
              icon: "settings",
              dividerBefore: true,
              onSelect: () => setShowSettings(true),
            },
          ]}
        />
      )}

      {/* Tab bar — always shown once a file is open (even with one tab), with a
          + button, so it's clear more files can be opened in tabs. TABS-01. */}
      {hasFile && !zenActive && tabBarItems.length >= 1 && (
        <TabBar
          tabs={tabBarItems}
          activeId={activeTabId}
          onSelect={activateTab}
          onClose={closeTab}
          onNewTab={handleNewFile}
          onReorder={handleReorderTab}
          onContextMenu={handleTabContextMenu}
        />
      )}

      {/* Startup update check; invisible unless an update is actually available.
          Skipped on mobile: the updater plugin isn't compiled there, so its
          invoke would be rejected outright. Phone updates ride the store/sideload
          instead. */}
      {!IS_MOBILE && (
        <Suspense fallback={null}>
          <UpdateDialog />
        </Suspense>
      )}

      {!hasFile ? (
        booting ? (
          // Neutral splash while the last-opened file is being restored — avoids
          // a one-frame WelcomeScreen flash before the editor mounts.
          <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
            <span className="material-symbols-outlined text-[28px] text-[var(--text-muted)] animate-spin">progress_activity</span>
          </div>
        ) : (
          <WelcomeScreen
            onOpenFile={handleOpenFileAction}
            onNewFile={handleNewFile}
            onOpenSettings={() => setShowSettings(true)}
            onFileDrop={handleFileDrop}
            onOpenRecent={loadFile}
          />
        )
      ) : (
        <>
          {/* Split-aware layout. Both views always mounted; CSS toggles their display
              and width so editor/preview state (scroll, selection) is preserved across
              mode switches. */}
          {/* Zen top bar: the only chrome left in zen. Desktop = hover-reveal
              panel with the Normal exit button and the window controls (the
              frameless window has no title bar in zen; its invisible hover
              strip doubles as the drag handle). Touch = slim in-flow bar with
              just the Normal chip, padded below the system status bar. */}
          {zenActive && (
            <ZenTopBar
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onExitZen={handleToggleZen}
            />
          )}
          <div
            ref={splitContainerRef}
            className="flex-1 overflow-hidden flex flex-row"
            // Reserve space on the right for the AI panel so editor/preview reflow
            // beside it instead of being covered. The panel itself is fixed at
            // right-0 (above the status bar), which keeps window controls at the edge.
            // min() mirrors the panel's own w-[400px] max-w-[90vw] so a narrow
            // window reserves only as much space as the panel actually takes.
            // The left drawers (FileExplorer / TableOfContents) are likewise fixed
            // at left-0, so reserve padding-left when one is open so they reflow the
            // editor beside them instead of overlaying it.
            // On mobile there is no reflow: the panels are full-screen sheets
            // (see index.css [data-panel]) and the content keeps the full width.
            style={{
                paddingLeft: !IS_MOBILE && !zenActive && (showFileExplorer || showTOC || showBacklinks) ? `${SIDEBAR_WIDTH}px` : 0,
                paddingRight: !IS_MOBILE && !zenActive && showAIPanel ? `min(${aiPanelWidth}px, 90vw)` : 0,
                transition: "padding 0.15s ease",
            }}
          >
            <div
              data-split-left
              className="overflow-hidden flex flex-col"
              style={{
                display: mode === "code" || mode === "split" ? "flex" : "none",
                flexBasis: mode === "split" ? `${splitRatio * 100}%` : "100%",
                flexGrow: mode === "split" ? 0 : 1,
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              <CodeEditor
                content={content}
                docSwapId={docSwapId}
                onChange={handleContentChange}
                onCursorChange={handleCursorChange}
                onSelectionChange={handleSelectionChange}
                onImagePaste={handleImagePaste}
                onError={handleError}
                onNotice={handleNotice}
                filePath={filePath}
                onScrollFraction={onCodeScrollFraction}
                registerScroller={registerCodeScroller}
                typewriterMode={typewriterModeEnabled}
                // On mobile the toolbar is the ONLY formatting surface (no
                // Ctrl+B, no menu row) so it is always on and cannot be hidden.
                showToolbar={IS_MOBILE || toolbarVisible}
                wordWrap={wordWrapEnabled}
                spellCheck={spellCheckEnabled}
                aiConfig={aiConfig}
                reviewDoc={proposedDoc}
                onReviewResolve={handleReviewResolve}
              />
            </div>

            {mode === "split" && (
              <SplitDivider onDrag={setSplitRatioState} containerRef={splitContainerRef} />
            )}

            <div
              className="overflow-hidden flex flex-col relative"
              style={{
                display: mode === "preview" || mode === "split" ? "flex" : "none",
                flexBasis: mode === "split" ? `${(1 - splitRatio) * 100}%` : "100%",
                flexGrow: mode === "split" ? 0 : 1,
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              {/* MarkdownPreview is lazy-loaded — its react-markdown +
                  remark-gfm + rehype-highlight stack is ~250 kB and
                  doesn't need to ship with the welcome screen. The
                  fallback is invisible since the parent column already
                  has a background; a brief flash on first render is
                  preferable to a spinner that pre-empts the layout. */}
              <Suspense fallback={null}>
                <MarkdownPreview
                  content={deferredContent}
                  fileName={fileName || ""}
                  fileSize={fileSize}
                  onEditClick={handleToggleMode}
                  onLineChange={handlePreviewLineChange}
                  filePath={filePath}
                  markdownBodyRef={previewRef}
                  onContentChange={handleContentChange}
                  onScrollFraction={onPreviewScrollFraction}
                  registerScroller={registerPreviewScroller}
                  onWikilinkClick={handleWikilinkClick}
                  onNavigateRelative={handleNavigateRelative}
                />
              </Suspense>

              {/* Reader-mode find. The same FindBar as the editor, driven by a
                  preview controller that searches the rendered text and
                  highlights matches via the CSS Custom Highlight API. */}
              <FindBar
                isOpen={previewFindOpen}
                controller={previewFindController}
                revision={content}
                onClose={() => setPreviewFindOpen(false)}
              />
            </div>
          </div>

          {/* The floating mode pill is a desktop affordance; the phone's bottom
              nav carries the Read/Edit toggle. Zen hides it on both shells. */}
          {!IS_MOBILE && !zenActive && (
            <ModeToggle mode={mode} onSetMode={setMode} aiPanelOpen={showAIPanel} aiPanelWidth={aiPanelWidth} />
          )}

          {/* Sidebar Panels — only mount when actually open so they don't
              load their module until first use. */}
          {!zenActive && showTOC && (
            <Suspense fallback={null}>
              <TableOfContents
                isOpen={showTOC}
                content={deferredContent}
                onClose={closeAllPanels}
                activeLine={mode === "preview" ? previewLine : cursorPosition.line}
              />
            </Suspense>
          )}
          {!zenActive && showBacklinks && currentDirectory && filePath && (
            <Suspense fallback={null}>
              <BacklinksPanel
                isOpen={showBacklinks}
                directory={currentDirectory}
                currentFilePath={filePath}
                onFileSelect={handleOpenSearchResult}
                onClose={closeAllPanels}
              />
            </Suspense>
          )}

          {/* Right-side AI assistant panel. Reads the live document + current
              selection; chat is read-only for now (edit/agent flow is next). */}
          {!zenActive && aiEnabled && showAIPanel && (
            <Suspense fallback={null}>
              <AIPanel
                isOpen={showAIPanel}
                onClose={() => setShowAIPanel(false)}
                note={content}
                fileName={fileName || ""}
                selectionText={content.slice(selectionRange.start, selectionRange.end)}
                aiConfig={aiConfig}
                onProposeEdit={handleProposeEdit}
                width={aiPanelWidth}
                onWidthChange={setAiPanelWidth}
              />
            </Suspense>
          )}

          {/* Bottom navigation — the phone's status bar replacement. Hidden on
              the welcome screen (its own buttons cover Files/New), while the
              keyboard is open (html.kb-open), and in zen mode. */}
          {IS_MOBILE && hasFile && !zenActive && (
            <MobileBottomNav
              hasFile={hasFile}
              mode={mode}
              onSetMode={setMode}
              onOpenFiles={handleOpenFileAction}
              outlineOpen={showTOC}
              onToggleOutline={handleToggleTOC}
            />
          )}

          {/* Desktop status bar. The phone's bottom nav + top bar dirty dot
              carry the same information (saved state, mode); word count lives
              in the menu's statistics entry. Zen hides it on both shells. */}
          {!IS_MOBILE && !zenActive && (
            <StatusBar
              isSaved={!isDirty}
              lineNumber={mode === "preview" ? previewLine : cursorPosition.line}
              columnNumber={cursorPosition.col}
              mode={mode}
              showFileExplorer={showFileExplorer}
              showTOC={showTOC}
              showBacklinks={showBacklinks}
              onToggleFileExplorer={handleToggleFileExplorer}
              onToggleTOC={handleToggleTOC}
              onToggleBacklinks={handleToggleBacklinks}
              wordCount={wordCount}
              charCount={charCount}
              readingTimeMin={readingTimeMin}
              selectionLength={mode !== "preview" ? selectionLength : 0}
              selectionWordCount={selectionWordCount}
            />
          )}
        </>
      )}

      {/* The file browser mounts OUTSIDE the hasFile conditional: on mobile it
          is the "Open" affordance (Browse notes) and must be reachable from
          the welcome screen, before any file exists. */}
      {showFileExplorer && (
        <Suspense fallback={null}>
          <FileExplorer
            isOpen={showFileExplorer}
            currentFilePath={filePath}
            fallbackDirectory={notesDir}
            onFileSelect={loadFile}
            onClose={closeAllPanels}
          />
        </Suspense>
      )}

      {/* Unsaved-changes dialog for window close — fed by the Tauri
          close-requested interception above, so it covers Alt+F4 and the
          taskbar close, not just the title bar X. */}
      {showUnsavedBeforeClose && (
        <Suspense fallback={null}>
          <UnsavedChangesDialog
            isOpen={showUnsavedBeforeClose}
            onClose={() => setShowUnsavedBeforeClose(false)}
            onDiscard={handleDiscardAndCloseWindow}
            onSave={handleSaveAndCloseWindow}
            dirtyNames={tabBarItems.filter((t) => t.dirty).map((t) => t.name)}
          />
        </Suspense>
      )}

      {/* Save/Discard/Cancel when closing a single dirty tab (Ctrl+W, the tab's
          × or middle-click). TABS-05. */}
      {closeTabPrompt && (
        <Suspense fallback={null}>
          <UnsavedChangesDialog
            isOpen={!!closeTabPrompt}
            onClose={cancelCloseTab}
            onDiscard={handleDiscardCloseTab}
            onSave={handleSaveCloseTab}
            dirtyNames={[closeTabPrompt.fileName]}
          />
        </Suspense>
      )}

      {/* Fullscreen transition cover. Fades in over 150ms (we wait for that
          before resizing, so the mid-resize reflow is fully masked), then fades
          out over 300ms to reveal the settled layout — a smooth dip in and out.
          The 150ms fade-in duration is mirrored by FS_FADE_IN_MS. Sits above
          everything; pointer-events-none so it never eats a click. */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-[200] bg-[var(--bg-primary)] pointer-events-none transition-[opacity,visibility] ease-out ${fsTransition ? "opacity-100 duration-150" : "opacity-0 invisible duration-300"}`}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg-primary)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[32px] text-[var(--accent)] animate-spin">progress_activity</span>
            <span className="text-sm text-[var(--text-secondary)]">Loading...</span>
          </div>
        </div>
      )}

      {/* Heavy modal surfaces — palette, settings, stats, cheatsheet — are
          off the cold-start critical path. They mount only when first
          opened so their bundles only download on demand. */}
      {showCheatsheet && (
        <Suspense fallback={null}>
          <ShortcutCheatsheet isOpen={showCheatsheet} onClose={() => setShowCheatsheet(false)} />
        </Suspense>
      )}
      {/* Stats dialog reads LIVE `content`, not the debounced version. The
          dialog opens on a discrete user action (palette command), not while
          typing, so the typing-fast-path argument doesn't apply — and a user
          who opens "Show document statistics" expects the numbers to match
          what they just typed. */}
      {showStats && (
        <Suspense fallback={null}>
          <StatsDialog isOpen={showStats} content={content} onClose={() => setShowStats(false)} />
        </Suspense>
      )}
      {showPalette && (
        <Suspense fallback={null}>
          <CommandPalette isOpen={showPalette} items={fullPaletteItems} onClose={() => setShowPalette(false)} />
        </Suspense>
      )}
      {showSearch && (
        <Suspense fallback={null}>
          <GlobalSearch
            isOpen={showSearch}
            directory={currentDirectory ?? (IS_MOBILE ? notesDir : null)}
            onClose={() => setShowSearch(false)}
            onOpenResult={handleOpenSearchResult}
          />
        </Suspense>
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            onClose={closeSettings}
          />
        </Suspense>
      )}

      {/* First-run welcome tour. Gated on hasFile because every spotlight
          target (editor panes, mode toggle) only exists with an open buffer. */}
      {showTour && hasFile && !booting && !zenActive && (
        <Tour onClose={handleCloseTour} onOpenTutorial={handleOpenTutorial} />
      )}

      {/* Tab right-click menu. TABS-12. */}
      {tabMenu && (() => {
        const menuTab = tabs.find((t) => t.id === tabMenu.id);
        const isActiveMenu = tabMenu.id === activeTabId;
        const menuPath = isActiveMenu ? filePath : (menuTab?.filePath ?? null);
        const idx = tabs.findIndex((t) => t.id === tabMenu.id);
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        const others = tabs.length > 1;
        return (
          <TabContextMenu
            x={tabMenu.x}
            y={tabMenu.y}
            onClose={() => setTabMenu(null)}
            actions={[
              // Touch reorder: HTML5 drag never fires on a phone, so the
              // long-press menu carries explicit move actions instead.
              ...(IS_MOBILE
                ? [
                    { label: "Move left", icon: "arrow_back", disabled: idx <= 0, onClick: () => handleReorderTab(idx, idx - 1) },
                    { label: "Move right", icon: "arrow_forward", disabled: !hasRight, onClick: () => handleReorderTab(idx, idx + 1) },
                  ]
                : []),
              { label: "Close", icon: "close", onClick: () => closeTab(tabMenu.id) },
              { label: "Close others", icon: "close_fullscreen", disabled: !others, onClick: () => handleTabMenuAction("closeOthers", tabMenu.id) },
              { label: "Close to the right", icon: "keyboard_tab", disabled: !hasRight, onClick: () => handleTabMenuAction("closeRight", tabMenu.id) },
              {
                label: "Copy path", icon: "content_copy", dividerBefore: true, disabled: !menuPath,
                onClick: () => { if (menuPath) navigator.clipboard.writeText(menuPath).then(() => showToast("File path copied", "success"), () => showToast("Could not copy path", "error")); },
              },
              // "Reveal in folder" opens the OS file manager — desktop only.
              ...(!IS_MOBILE
                ? [
                    {
                      label: "Reveal in folder", icon: "folder_open", disabled: !menuPath,
                      onClick: () => { if (menuPath) revealItemInDir(menuPath).catch(() => showToast("Could not reveal file", "error")); },
                    },
                  ]
                : []),
            ]}
          />
        );
      })()}

      {/* Mobile Save-As name prompt. Mounted while a save location is pending;
          resolves with a notes-dir path, the Downloads sentinel, or null. */}
      {IS_MOBILE && saveAsRequest && (
        <SaveAsNameModal
          isOpen
          defaultName={saveAsRequest.defaultName}
          notesPath={notesDir}
          onConfirm={handleSaveAsConfirm}
        />
      )}

      {/* Toast notifications */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
