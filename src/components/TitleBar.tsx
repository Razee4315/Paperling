import { memo, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Window } from "@tauri-apps/api/window";
import { SettingsMenu } from "./SettingsMenu";
import { ExportMenu } from "./ExportMenu";
import { EditMenu } from "./EditMenu";
import { formatShortcut } from "../config/keybindings";
import { getAIIconAnimation } from "../utils/persistence";

interface TitleBarProps {
    fileName?: string;
    isDirty?: boolean;
    filePath?: string;
    onOpenFile?: () => void;
    onNewFile?: () => void;
    getExportHtml?: () => Promise<string>;
    onExportSuccess?: (format: string) => void;
    onExportError?: (format: string) => void;
    onToggleAI?: () => void;
    aiActive?: boolean;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    /** Edit-menu actions: open find / find-and-replace / cross-file search. */
    onFind?: () => void;
    onReplace?: () => void;
    onFindInFiles?: () => void;
}

function TitleBarImpl({ fileName, isDirty, filePath, onOpenFile, onNewFile, getExportHtml, onExportSuccess, onExportError, onToggleAI, aiActive, isFullscreen, onToggleFullscreen, onFind, onReplace, onFindInFiles }: TitleBarProps) {
    // Whether the AI button's icon shimmers. Some users prefer it plain (#111).
    // Held locally and refreshed from the Settings event rather than threaded
    // down from App, since nothing else on the way needs to know about it.
    const [aiIconAnimated, setAiIconAnimated] = useState(getAIIconAnimation);
    useEffect(() => {
        const onToggle = (e: Event) => setAiIconAnimated(!!(e as CustomEvent).detail?.enabled);
        window.addEventListener("paperling:ai-icon-animation-toggle", onToggle);
        return () => window.removeEventListener("paperling:ai-icon-animation-toggle", onToggle);
    }, []);

    const handleMinimize = async () => {
        try {
            const appWindow = Window.getCurrent();
            await appWindow.minimize();
        } catch (e) {
            console.error("Minimize failed:", e);
        }
    };

    const handleMaximize = async () => {
        // While fullscreen, this button is the "exit fullscreen" control —
        // toggling maximize underneath an active fullscreen is what produced
        // the black-bar / stuck-taskbar state on Windows. Route it through the
        // same fullscreen toggle (which also restores the prior maximize).
        if (isFullscreen) {
            onToggleFullscreen?.();
            return;
        }
        try {
            const appWindow = Window.getCurrent();
            await appWindow.toggleMaximize();
        } catch (e) {
            console.error("Maximize failed:", e);
        }
    };

    const handleTitleBarMouseDown = async (event: MouseEvent<HTMLElement>) => {
        const target = event.target;

        if (
            event.button !== 0 ||
            (target instanceof Element &&
                target.closest("button, a, input, textarea, select, [role='button'], [role='menu'], [role='menuitem']"))
        ) {
            return;
        }

        try {
            const appWindow = Window.getCurrent();
            // Native title bars maximize on double-click; event.detail
            // counts clicks within the double-click interval. While fullscreen
            // a double-click exits it (same reason as the maximize button).
            if (event.detail === 2) {
                if (isFullscreen) onToggleFullscreen?.();
                else await appWindow.toggleMaximize();
            } else {
                await appWindow.startDragging();
            }
        } catch (e) {
            console.error("Window drag failed:", e);
        }
    };

    // close() fires the Tauri close-requested event, which App intercepts when
    // the buffer is dirty (CLOSE-01) — same code path as Alt+F4 and the
    // taskbar close, so the unsaved-changes flow lives in exactly one place.
    const handleCloseClick = async () => {
        try {
            const appWindow = Window.getCurrent();
            await appWindow.close();
        } catch (e) {
            console.error("Close failed:", e);
        }
    };

    // Extract parent folder from path for breadcrumb
    const getPathBreadcrumb = () => {
        if (!filePath) return null;
        const parts = filePath.replace(/\\/g, "/").split("/");
        if (parts.length >= 2) {
            return parts.slice(-2, -1)[0];
        }
        return null;
    };

    const parentFolder = getPathBreadcrumb();
    const hasFile = !!fileName;

    return (
        <>
            <header
                onMouseDown={handleTitleBarMouseDown}
                className="h-12 shrink-0 flex items-center justify-between px-4 bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select drag-region transition-colors"
            >
                {/* Left: Icon & Title */}
                <div className="flex items-center gap-3 no-drag">
                    <div className="flex items-center justify-center w-5 h-5">
                        <img src="/icon.svg" alt="Paperling" className="w-full h-full" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-w-0">
                        {parentFolder && (
                            <>
                                <span className="opacity-60 hidden md:inline">{parentFolder} /</span>
                            </>
                        )}
                        <span className="text-[var(--text-primary)] font-semibold tracking-tight truncate max-w-[28vw]">
                            {fileName || "Paperling"}
                        </span>
                        {!fileName && (
                            <span className="text-[var(--text-muted)] text-xs ml-1 hidden sm:inline">— drop a .md file or {formatShortcut("openFile")}</span>
                        )}
                        {isDirty && (
                            <span className="text-[var(--status-unsaved)] ml-1 italic text-xs">— Edited</span>
                        )}
                    </div>

                    {/* Open File / New Button - shown when a file is already open */}
                    {hasFile && onOpenFile && (
                        <>
                            <div className="w-[1px] h-4 bg-[var(--border)] ml-2"></div>
                            {onNewFile && (
                                <button
                                    onClick={onNewFile}
                                    aria-label="New file"
                                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs"
                                    title={`New File (${formatShortcut("newFile")})`}
                                >
                                    <span className="material-symbols-outlined text-[16px]">edit_note</span>
                                    <span className="hidden sm:inline">New</span>
                                </button>
                            )}
                            <button
                                onClick={onOpenFile}
                                aria-label="Open file"
                                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs"
                                title={`Open File (${formatShortcut("openFile")})`}
                            >
                                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                                <span className="hidden sm:inline">Open</span>
                            </button>
                            {onFind && onReplace && onFindInFiles && (
                                <EditMenu onFind={onFind} onReplace={onReplace} onFindInFiles={onFindInFiles} />
                            )}
                            <ExportMenu
                                fileName={fileName || 'document.md'}
                                getExportHtml={getExportHtml}
                                onSuccess={onExportSuccess}
                                onError={onExportError}
                            />
                            {onToggleAI && (
                                <button
                                    onClick={onToggleAI}
                                    aria-label="AI assistant"
                                    aria-pressed={aiActive}
                                    title="AI assistant"
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-md)] transition-colors text-xs font-semibold tracking-wide ${aiActive
                                        ? "bg-[var(--bg-hover)] text-[var(--accent)]"
                                        : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                        }`}
                                >
                                    <span className={`material-symbols-outlined text-[15px]${aiIconAnimated ? " ai-shimmer" : ""}`} aria-hidden="true">auto_awesome</span>
                                    <span>AI</span>
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Right: Settings & Window Controls */}
                <div className="flex items-center gap-1 no-drag">
                    <SettingsMenu />
                    <div className="w-[1px] h-4 bg-[var(--border)] mx-1"></div>
                    <button
                        onClick={handleMinimize}
                        aria-label="Minimize"
                        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">remove</span>
                    </button>
                    <button
                        onClick={handleMaximize}
                        aria-label={isFullscreen ? "Exit fullscreen" : "Maximize"}
                        title={isFullscreen ? "Exit fullscreen (F11)" : "Maximize"}
                        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[16px]">{isFullscreen ? "fullscreen_exit" : "crop_square"}</span>
                    </button>
                    <button
                        onClick={handleCloseClick}
                        aria-label="Close"
                        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--danger)] text-[var(--text-secondary)] hover:text-[var(--accent-text)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </header>
        </>
    );
}

// React.memo + useCallback'd parent props means the TitleBar skips re-render
// while the user is typing. Without this every keystroke reconciled the
// header — cheap individually, but it adds up on hot paths. The default
// shallow prop comparison is enough; all props are primitives or stable
// callbacks from App.
export const TitleBar = memo(TitleBarImpl);
