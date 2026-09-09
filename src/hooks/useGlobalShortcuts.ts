import { useEffect, useRef } from "react";
import { matchesBinding, isPlainModCombo } from "../config/keybindings";

/** Everything the global keyboard handler needs. Kept in a ref so the window
 *  listener is attached once and never re-bound on a handler/state change. */
export interface ShortcutHandlers {
    handleOpenFile: () => void;
    handleSaveFile: () => void;
    handleSaveAs: () => void;
    handleNewFile: () => void;
    handleToggleMode: () => void;
    handleToggleSplit: () => void;
    /** Toggle Zen mode (F9). Works with or without a file open. */
    toggleZen: () => void;
    /** Toggle OS fullscreen (F11). Cross-platform via the Tauri window API. */
    toggleFullscreen: () => void;
    handleToggleFileExplorer: () => void;
    handleToggleTOC: () => void;
    openCheatsheet: () => void;
    openPalette: () => void;
    openSettings: () => void;
    /** Open the reader-mode find bar. Only invoked when mode === "preview". */
    openPreviewFind?: () => void;
    /** Open cross-file search (mod+Shift+F). */
    openSearch?: () => void;
    /** Close the active tab (mod+W). */
    closeActiveTab?: () => void;
    /** Switch to the previous/next tab (Alt+Left/Right, Ctrl+Shift+Tab / Ctrl+Tab). */
    prevTab?: () => void;
    nextTab?: () => void;
    /** Reopen the most recently closed tab (mod+Shift+T). */
    reopenClosedTab?: () => void;
    /** Jump to a tab by index; -1 means the last tab (mod+1..9). */
    gotoTab?: (index: number) => void;
    hasFile: boolean;
    content: string;
    /** Current view mode — the find shortcut routes to the preview find bar in
     *  reader mode (the CodeMirror keymap owns find when the editor has focus). */
    mode?: "preview" | "code" | "split";
}

/**
 * App-wide keyboard shortcuts, mounted once on the window. Reads the latest
 * handlers/state through a ref so the listener never has to be torn down and
 * re-added on a keystroke (which an effect dep-array on `content` would force).
 *
 * All combos are matched through the central platform config
 * (src/config/keybindings.ts): the primary modifier resolves to Cmd on macOS
 * and Ctrl on Windows/Linux, so these shortcuts are Mac-native. Tab cycling is
 * the deliberate exception — it stays a literal Ctrl everywhere because ⌘Tab is
 * the macOS app-switcher.
 */
export function useGlobalShortcuts(handlers: ShortcutHandlers) {
    const ref = useRef(handlers);
    ref.current = handlers;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const s = ref.current;
            // F11 - Toggle fullscreen. The universal fullscreen key on Windows
            // and Linux. macOS reserves F11 for Show Desktop, where users
            // fullscreen via the green title-bar button; the underlying Tauri
            // setFullscreen drives the same window state either way. No file
            // needed — works on the welcome screen too. FULLSCREEN-01.
            if (matchesBinding(e, "fullscreen")) {
                e.preventDefault();
                s.toggleFullscreen();
                return;
            }
            // mod+Shift+E - Toggle file explorer
            if (matchesBinding(e, "toggleFileExplorer")) {
                e.preventDefault();
                if (s.hasFile) s.handleToggleFileExplorer();
                return;
            }
            // mod+Shift+O - Toggle TOC
            if (matchesBinding(e, "toggleTOC")) {
                e.preventDefault();
                if (s.hasFile) s.handleToggleTOC();
                return;
            }
            // mod+O - Open file
            if (matchesBinding(e, "openFile")) {
                e.preventDefault();
                s.handleOpenFile();
                return;
            }
            // mod+S - Save file
            if (matchesBinding(e, "save")) {
                e.preventDefault();
                if (s.hasFile || s.content) s.handleSaveFile();
                return;
            }
            // mod+Shift+S - Save As
            if (matchesBinding(e, "saveAs")) {
                e.preventDefault();
                if (s.hasFile || s.content) s.handleSaveAs();
                return;
            }
            // mod+N - New file
            if (matchesBinding(e, "newFile")) {
                e.preventDefault();
                s.handleNewFile();
                return;
            }
            // mod+E - Toggle preview/code mode
            if (matchesBinding(e, "toggleMode")) {
                e.preventDefault();
                if (s.hasFile) s.handleToggleMode();
                return;
            }
            // mod+\ - Toggle split view
            if (matchesBinding(e, "toggleSplit")) {
                e.preventDefault();
                if (s.hasFile) s.handleToggleSplit();
                return;
            }
            // F9 - Toggle Zen mode (distraction-free reading canvas). No
            // hasFile gate: the flag persists, so enabling it on the welcome
            // screen still takes effect when the next file opens. ZEN-01.
            if (matchesBinding(e, "zenMode")) {
                e.preventDefault();
                s.toggleZen();
                return;
            }
            // mod+W - close the active tab (falls back to the welcome screen
            // when it's the last one). The webview doesn't reserve this.
            if (matchesBinding(e, "closeTab")) {
                e.preventDefault();
                if (s.hasFile) s.closeActiveTab?.();
                return;
            }
            // mod+Shift+F - search across all files in the folder (checked
            // before the unshifted find below, which shift-exclusivity already
            // separates, but keeping it first mirrors the original intent).
            if (matchesBinding(e, "searchInFolder")) {
                e.preventDefault();
                if (s.hasFile) s.openSearch?.();
                return;
            }
            // Find in reader mode - find in preview. In code/split mode the
            // focused editor's own keymap handles Mod-f, so we do nothing here
            // (no preventDefault) and let the editor keymap take it.
            if (matchesBinding(e, "find")) {
                if (s.hasFile && s.mode === "preview" && s.openPreviewFind) {
                    e.preventDefault();
                    s.openPreviewFind();
                }
                return;
            }
            // Alt+Left / Alt+Right - switch to the previous/next tab. Alt (not
            // Ctrl) keeps Ctrl+Arrow free for word-wise caret movement in the
            // editor. TABS-01.
            if (matchesBinding(e, "prevTabAlt")) {
                e.preventDefault();
                if (s.hasFile) s.prevTab?.();
                return;
            }
            if (matchesBinding(e, "nextTabAlt")) {
                e.preventDefault();
                if (s.hasFile) s.nextTab?.();
                return;
            }
            // Ctrl+Tab / Ctrl+Shift+Tab - cycle tabs (literal Ctrl on all
            // platforms; ⌘Tab is the macOS app-switcher). TABS-16.
            if (matchesBinding(e, "prevTab")) {
                e.preventDefault();
                if (s.hasFile) s.prevTab?.();
                return;
            }
            if (matchesBinding(e, "nextTab")) {
                e.preventDefault();
                if (s.hasFile) s.nextTab?.();
                return;
            }
            // Ctrl+PageDown / Ctrl+PageUp - the other common tab-cycle alias.
            if (matchesBinding(e, "nextTabPage")) {
                e.preventDefault();
                if (s.hasFile) s.nextTab?.();
                return;
            }
            if (matchesBinding(e, "prevTabPage")) {
                e.preventDefault();
                if (s.hasFile) s.prevTab?.();
                return;
            }
            // mod+Shift+T - reopen the most recently closed tab. TABS-15.
            if (matchesBinding(e, "reopenClosedTab")) {
                e.preventDefault();
                s.reopenClosedTab?.();
                return;
            }
            // mod+1..9 - jump to tab N (9 = last tab, like browsers). TABS-16.
            if (isPlainModCombo(e) && e.key >= "1" && e.key <= "9") {
                e.preventDefault();
                if (s.hasFile) s.gotoTab?.(e.key === "9" ? -1 : Number(e.key) - 1);
                return;
            }
            // ? - Show cheatsheet (only when no input is focused)
            if (matchesBinding(e, "cheatsheet")) {
                const target = e.target as HTMLElement | null;
                const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
                if (!isTyping) {
                    e.preventDefault();
                    s.openCheatsheet();
                }
                return;
            }
            // mod+P - command palette
            if (matchesBinding(e, "palette")) {
                e.preventDefault();
                s.openPalette();
                return;
            }
            // mod+, - Settings
            if (matchesBinding(e, "settings")) {
                e.preventDefault();
                s.openSettings();
                return;
            }
            // AI assist - Alt+J everywhere, Cmd+J on macOS. Handled here (window
            // level) rather than only in the editor so it fires regardless of
            // focus; the editor opens the bubble via the paperling:ai-assist
            // listener. (Ctrl+J is reserved by WebView2 on Windows, hence Alt+J.)
            const isAltJ = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "j" || e.key === "J" || e.code === "KeyJ");
            const isCmdJ = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "j" || e.key === "J");
            if (isAltJ || isCmdJ) {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("paperling:ai-assist"));
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        // Defense-in-depth for Ctrl+J: Edge/Chrome/WebView2 treat Ctrl+J as a
        // "browser accelerator" for Downloads. On WebView2 (Windows) the page
        // never sees this keydown, so JS can't help — users have Alt+J as the
        // working alias there. On WebKitGTK (Linux) and WKWebView (macOS) the
        // event DOES reach the page; we capture-phase preventDefault here so the
        // host webview's default action is suppressed regardless of which
        // element is focused (textarea, palette input, settings, etc.).
        const blockCtrlJ = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "j" || e.key === "J")) {
                e.preventDefault();
            }
        };
        window.addEventListener("keydown", blockCtrlJ, { capture: true });

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keydown", blockCtrlJ, { capture: true } as EventListenerOptions);
        };
    }, []);
}
