import { memo, useCallback } from "react";
import type { MouseEvent } from "react";
import { Window } from "@tauri-apps/api/window";
// Touch devices have no hover, and phones have no window manager to talk to:
// there the bar renders IN FLOW (always visible, exit chip only, padded below
// the system status bar). Desktop keeps the hover-reveal overlay with the
// window controls and the frameless-window drag handle. ZEN-02 / MOBILE-ZEN.
import { IS_MOBILE, IS_TOUCH } from "../utils/platform";

interface ZenTopBarProps {
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    /** Leave Zen mode and restore the normal chrome. */
    onExitZen: () => void;
}

function ZenTopBarImpl({ isFullscreen, onToggleFullscreen, onExitZen }: ZenTopBarProps) {
    const handleMinimize = useCallback(async () => {
        try {
            await Window.getCurrent().minimize();
        } catch {/* browser dev mode — no Tauri window */}
    }, []);

    const handleMaximize = useCallback(async () => {
        // Same contract as the title bar: while fullscreen this button exits
        // fullscreen instead of toggling maximize underneath it. ZEN-02.
        if (isFullscreen) {
            onToggleFullscreen?.();
            return;
        }
        try {
            await Window.getCurrent().toggleMaximize();
        } catch {/* browser dev mode */}
    }, [isFullscreen, onToggleFullscreen]);

    // close() fires the Tauri close-requested event, which App intercepts when
    // the buffer is dirty — the same code path as Alt+F4, so unsaved work is
    // still guarded from zen. ZEN-02.
    const handleClose = useCallback(async () => {
        try {
            await Window.getCurrent().close();
        } catch {/* browser dev mode */}
    }, []);

    // The bar (and its invisible hover strip) doubles as the drag handle for
    // the frameless window; buttons opt out so they stay clickable. ZEN-02.
    // Phones skip all of it — startDragging/maximize are desktop window-manager
    // concepts, and a stray synthetic mousedown from a tap must not reach them.
    const handleBarMouseDown = useCallback(async (event: MouseEvent<HTMLElement>) => {
        if (IS_MOBILE) return;
        const target = event.target;
        if (
            event.button !== 0 ||
            (target instanceof Element && target.closest("button"))
        ) {
            return;
        }
        try {
            const appWindow = Window.getCurrent();
            if (event.detail === 2) {
                if (isFullscreen) onToggleFullscreen?.();
                else await appWindow.toggleMaximize();
            } else {
                await appWindow.startDragging();
            }
        } catch {/* browser dev mode */}
    }, [isFullscreen, onToggleFullscreen]);

    return (
        <div
            className={IS_TOUCH
                ? "relative shrink-0 z-50"
                : "absolute top-0 inset-x-0 z-50 group/zenbar"}
            onMouseDown={IS_TOUCH ? undefined : handleBarMouseDown}
        >
            {/* Invisible hover trigger (also a drag strip while the bar is
                hidden, so the window stays movable in zen). Desktop only —
                touch has no hover to catch. */}
            {!IS_TOUCH && <div className="h-3 w-full" aria-hidden="true" />}
            {/* Desktop: reveal panel, hidden until the mouse reaches the top
                edge, then fades/slides in. `invisible` (not just opacity-0)
                keeps the buttons out of the tab order and away from screen
                readers while hidden; the hide lags 150ms so a slipping mouse
                doesn't flicker it. ZEN-02.
                Touch: the same row, permanently visible and in flow, so the
                exit is reachable without a keyboard or hover; the status-bar
                safe-area inset is honoured like the mobile top bar's. */}
            <div
                role="toolbar"
                aria-label="Zen mode top bar"
                style={{ paddingTop: "var(--safe-area-top, 0px)" }}
                className={IS_TOUCH
                    ? "relative min-h-11 flex items-center justify-between pl-3 pr-2 bg-[var(--bg-titlebar)] border-b border-[var(--border)]"
                    : "absolute top-0 inset-x-0 h-11 flex items-center justify-between pl-3 pr-2 bg-[var(--bg-titlebar)]/95 backdrop-blur-sm border-b border-[var(--border)] transition-all duration-150 delay-150 group-hover/zenbar:delay-0 invisible opacity-0 -translate-y-1 pointer-events-none group-hover/zenbar:visible group-hover/zenbar:opacity-100 group-hover/zenbar:translate-y-0 group-hover/zenbar:pointer-events-auto"}
            >
                <button
                    onClick={onExitZen}
                    aria-label="Exit Zen mode"
                    title="Back to normal view (F9)"
                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs"
                >
                    <span className="material-symbols-outlined text-[16px]">web_asset</span>
                    <span>Normal</span>
                </button>
                {!IS_MOBILE && (
                    <div className="flex items-center gap-1">
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
                            onClick={handleClose}
                            aria-label="Close"
                            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--danger)] text-[var(--text-secondary)] hover:text-[var(--accent-text)] transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export const ZenTopBar = memo(ZenTopBarImpl);
