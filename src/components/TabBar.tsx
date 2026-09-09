import { memo, useEffect, useRef, useState } from "react";
import { IS_TOUCH } from "../utils/platform";

export interface TabBarItem {
    id: string;
    /** Bare file name — used for the tooltip and accessible name. */
    name: string;
    /** Display label; may be disambiguated with a folder suffix (TABS-09). */
    label: string;
    dirty: boolean;
}

interface TabBarProps {
    tabs: TabBarItem[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNewTab: () => void;
    /** Drag-reorder: move the tab at fromIndex to toIndex. TABS-10. */
    onReorder?: (fromIndex: number, toIndex: number) => void;
    /** Right-click (or long-press) context menu on a tab. TABS-12. */
    onContextMenu?: (id: string, x: number, y: number) => void;
}

// Long-press guards (the lessons-doc pair): cancel past ~10px of movement or
// every flick down the strip opens the menu, and the click that follows a
// fired long-press is swallowed or the tab would BOTH open its menu and
// activate.
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

function TabBarImpl({ tabs, activeId, onSelect, onClose, onNewTab, onReorder, onContextMenu }: TabBarProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);
    const longPressRef = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
    // Set when a long-press fires; consumed by the next click. pointerup runs
    // BEFORE click, so the click can't read the (already cleared) press state.
    const suppressClickRef = useRef(false);

    // Keep the active tab scrolled into view when it changes (e.g. Ctrl+Tab to a
    // tab that's currently off-screen in an overflowing bar). TABS-13.
    useEffect(() => {
        if (!activeId) return;
        tabRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeId, tabs.length]);

    // Vertical wheel scrolls the bar horizontally, like a browser tab strip.
    const onWheel = (e: React.WheelEvent) => {
        const el = listRef.current;
        if (!el || e.deltaY === 0) return;
        el.scrollLeft += e.deltaY;
    };

    const clearLongPress = () => {
        if (longPressRef.current) {
            window.clearTimeout(longPressRef.current.timer);
            longPressRef.current = null;
        }
    };

    // Touch-only: a held tab opens the same context menu a right-click does on
    // desktop. HTML5 drag-and-drop never fires on touch, so this is the phone's
    // route to the reorder actions ("Move left/right" in the menu).
    const onPointerDown = (e: React.PointerEvent, id: string) => {
        if (e.pointerType !== "touch" || !onContextMenu) return;
        clearLongPress();
        const startX = e.clientX;
        const startY = e.clientY;
        const state = { timer: 0, x: startX, y: startY, fired: false };
        state.timer = window.setTimeout(() => {
            state.fired = true;
            suppressClickRef.current = true;
            onContextMenu(id, startX, startY);
            longPressRef.current = state;
        }, LONG_PRESS_MS);
        longPressRef.current = state;
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const st = longPressRef.current;
        if (!st || st.fired) return;
        if (Math.abs(e.clientX - st.x) > LONG_PRESS_MOVE_PX || Math.abs(e.clientY - st.y) > LONG_PRESS_MOVE_PX) {
            clearLongPress();
        }
    };

    // Roving-tabindex keyboard navigation across the tablist. TABS-14.
    const onKeyDown = (e: React.KeyboardEvent, index: number) => {
        const focusAndSelect = (i: number) => {
            const t = tabs[i];
            if (!t) return;
            onSelect(t.id);
            tabRefs.current.get(t.id)?.focus();
        };
        if (e.key === "ArrowRight") {
            e.preventDefault();
            focusAndSelect((index + 1) % tabs.length);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            focusAndSelect((index - 1 + tabs.length) % tabs.length);
        } else if (e.key === "Home") {
            e.preventDefault();
            focusAndSelect(0);
        } else if (e.key === "End") {
            e.preventDefault();
            focusAndSelect(tabs.length - 1);
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(tabs[index].id);
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onClose(tabs[index].id);
        }
    };

    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label="Open files"
            onWheel={onWheel}
            className="h-9 shrink-0 flex items-stretch overflow-x-auto bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select"
        >
            {tabs.map((tab, index) => {
                const isActive = tab.id === activeId;
                const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
                return (
                    <div
                        key={tab.id}
                        ref={(el) => {
                            if (el) tabRefs.current.set(tab.id, el);
                            else tabRefs.current.delete(tab.id);
                        }}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        title={tab.name}
                        // HTML5 drag-and-drop does not fire on touch at all —
                        // not degraded, absent. Reordering on a phone goes
                        // through the long-press menu instead, so the
                        // draggable attribute (which also fights touch
                        // scrolling when present) is desktop-only.
                        draggable={!!onReorder && !IS_TOUCH}
                        onKeyDown={(e) => onKeyDown(e, index)}
                        onPointerDown={(e) => onPointerDown(e, tab.id)}
                        onPointerMove={onPointerMove}
                        onPointerUp={clearLongPress}
                        onPointerCancel={clearLongPress}
                        onClick={() => {
                            // Swallow the tap that follows a fired long-press.
                            if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                            }
                            onSelect(tab.id);
                        }}
                        onDragStart={(e) => {
                            setDragIndex(index);
                            e.dataTransfer.effectAllowed = "move";
                            // Firefox requires data to be set for a drag to start.
                            e.dataTransfer.setData("text/plain", tab.id);
                        }}
                        onDragOver={(e) => {
                            if (dragIndex === null) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (overIndex !== index) setOverIndex(index);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (dragIndex !== null && dragIndex !== index) onReorder?.(dragIndex, index);
                            setDragIndex(null);
                            setOverIndex(null);
                        }}
                        onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                        onMouseDown={(e) => {
                            // Middle-click closes, like a browser.
                            if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
                        }}
                        onContextMenu={(e) => {
                            if (!onContextMenu) return;
                            e.preventDefault();
                            onContextMenu(tab.id, e.clientX, e.clientY);
                        }}
                        className={`group/tab relative flex items-center gap-2 pl-3 pr-2 shrink-0 min-w-[110px] max-w-[200px] cursor-pointer border-r border-[var(--border)] transition-colors outline-none ${
                            isActive
                                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        } ${isDropTarget ? "ring-1 ring-inset ring-[var(--accent)]" : ""}`}
                    >
                        {/* Active-tab top accent */}
                        {isActive && <span className="absolute left-0 top-0 h-[2px] w-full bg-[var(--accent)]" aria-hidden="true" />}
                        <span className="material-symbols-outlined text-[14px] shrink-0 opacity-70">description</span>
                        <span className="truncate text-xs">{tab.label}</span>
                        {/* Trailing control. On hover it's always a close (×)
                            button. When the tab has unsaved edits and isn't
                            hovered, it shows a small "unsaved" dot instead —
                            same colour as the status bar's unsaved indicator, so
                            the meaning is consistent across the app. On touch
                            there is no hover, so a hover-hidden control would be
                            UNREACHABLE, not just awkward: the dot and the × are
                            both permanently visible and the × grows to a real
                            tap target. */}
                        <button
                            onMouseDown={(e) => { e.stopPropagation(); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                            tabIndex={-1}
                            aria-label={`Close ${tab.name}`}
                            title={tab.dirty ? "Unsaved changes — click to close" : "Close"}
                            className={`shrink-0 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${
                                IS_TOUCH ? "w-7 h-7" : "w-4 h-4"
                            }`}
                        >
                            {tab.dirty && (
                                <span
                                    className={`w-1.5 h-1.5 rounded-full bg-[var(--status-unsaved)] ${IS_TOUCH ? "" : "group-hover/tab:hidden"}`}
                                    aria-hidden="true"
                                />
                            )}
                            <span
                                className={`material-symbols-outlined text-[16px] leading-none ${
                                    tab.dirty
                                        ? IS_TOUCH ? "inline" : "hidden group-hover/tab:inline"
                                        : IS_TOUCH ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100"
                                }`}
                                aria-hidden="true"
                            >close</span>
                        </button>
                    </div>
                );
            })}
            {/* New-tab button — always visible so it's clear more files can be
                opened in tabs. */}
            <button
                onClick={onNewTab}
                aria-label="New tab"
                title="New tab (Ctrl+N)"
                className={`shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors ${
                    IS_TOUCH ? "w-11" : "w-9"
                }`}
            >
                <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
        </div>
    );
}

export const TabBar = memo(TabBarImpl);
