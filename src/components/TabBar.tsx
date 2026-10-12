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
// Mouse travel before a press on a tab becomes a reorder drag, so an ordinary
// click with a slight wobble still just selects the tab. TABS-24.
const DRAG_START_PX = 5;

/**
 * Horizontal offset for a tab that isn't being dragged: tabs between the
 * drag's origin and its current slot slide one dragged-tab width toward the
 * origin, opening a gap where the tab will land, like a browser tab strip.
 * TABS-24.
 */
export function tabShiftFor(index: number, from: number, over: number, width: number): number {
    if (from < over && index > from && index <= over) return -width;
    if (from > over && index >= over && index < from) return width;
    return 0;
}

/**
 * Index of the tab under clientX, from the tabs' left/right edges in strip
 * order. Past either end it clamps to the first or last tab. TABS-24.
 */
export function tabIndexAtX(rects: ReadonlyArray<{ left: number; right: number }>, x: number): number {
    if (rects.length === 0) return -1;
    for (let i = 0; i < rects.length; i++) {
        if (x < rects[i].right) return i;
    }
    return rects.length - 1;
}

function TabBarImpl({ tabs, activeId, onSelect, onClose, onNewTab, onReorder, onContextMenu }: TabBarProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);
    // How far the dragged tab has followed the pointer, in px.
    const [dragDx, setDragDx] = useState(0);
    // True for the frame after a drop, so tabs snap into their new DOM order
    // instead of animating out of their old shifted positions.
    const [settling, setSettling] = useState(false);
    const longPressRef = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
    // Set when a long-press fires; consumed by the next click. pointerup runs
    // BEFORE click, so the click can't read the (already cleared) press state.
    const suppressClickRef = useRef(false);
    // Desktop reorder drag. Tracked with pointer events, not HTML5
    // drag-and-drop: Tauri's native file-drop handler (dragDropEnabled, which
    // opening a dropped .md depends on) swallows in-page drag events in the
    // macOS webview, so `draggable` tabs never moved there. TABS-24.
    // `rects` is the strip's layout at drag start: once tabs are transformed,
    // live bounding rects would chase their own animation.
    const mouseDragRef = useRef<{
        pointerId: number;
        from: number;
        x: number;
        started: boolean;
        over: number;
        rects: { left: number; right: number }[];
    } | null>(null);

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
    const onPointerDown = (e: React.PointerEvent, id: string, index: number) => {
        if (e.pointerType !== "touch") {
            if (e.button !== 0 || !onReorder) return;
            mouseDragRef.current = { pointerId: e.pointerId, from: index, x: e.clientX, started: false, over: index, rects: [] };
            return;
        }
        if (!onContextMenu) return;
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
        const drag = mouseDragRef.current;
        if (drag && drag.pointerId === e.pointerId) {
            if (!drag.started) {
                if (Math.abs(e.clientX - drag.x) < DRAG_START_PX) return;
                drag.started = true;
                drag.rects = tabs.map((t) => {
                    const r = tabRefs.current.get(t.id)?.getBoundingClientRect();
                    return { left: r?.left ?? 0, right: r?.right ?? 0 };
                });
                // Keep receiving moves when the pointer leaves the tab.
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                setDragIndex(drag.from);
                setOverIndex(drag.from);
            }
            const { rects, from } = drag;
            const origin = rects[from];
            // The tab follows the pointer but stays within the strip.
            const dx = Math.min(
                Math.max(e.clientX - drag.x, rects[0].left - origin.left),
                rects[rects.length - 1].right - origin.right,
            );
            setDragDx(dx);
            // Its slot is wherever its centre now sits.
            const over = tabIndexAtX(rects, (origin.left + origin.right) / 2 + dx);
            if (over !== drag.over) {
                drag.over = over;
                setOverIndex(over);
            }
            return;
        }
        const st = longPressRef.current;
        if (!st || st.fired) return;
        if (Math.abs(e.clientX - st.x) > LONG_PRESS_MOVE_PX || Math.abs(e.clientY - st.y) > LONG_PRESS_MOVE_PX) {
            clearLongPress();
        }
    };

    const endMouseDrag = (e: React.PointerEvent, commit: boolean) => {
        const drag = mouseDragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        mouseDragRef.current = null;
        if (!drag.started) return;
        // The click that follows the release must not also select the tab. If
        // no click comes (released off the strip), drop the flag after this
        // task so it can't swallow the next real click.
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        if (commit && drag.over >= 0 && drag.over !== drag.from) onReorder?.(drag.from, drag.over);
        setDragIndex(null);
        setOverIndex(null);
        setDragDx(0);
        setSettling(true);
        window.requestAnimationFrame(() => setSettling(false));
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
            // Double-click the empty strip for a new tab, as in browsers and
            // VS Code. TABS-21.
            onDoubleClick={(e) => { if (e.target === e.currentTarget) onNewTab(); }}
            className="tab-strip h-9 shrink-0 flex items-stretch overflow-x-auto bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select"
        >
            {tabs.map((tab, index) => {
                const isActive = tab.id === activeId;
                const isDragged = dragIndex === index;
                let offset = 0;
                if (isDragged) offset = dragDx;
                else if (dragIndex !== null && overIndex !== null) {
                    const r = mouseDragRef.current?.rects[dragIndex];
                    offset = tabShiftFor(index, dragIndex, overIndex, r ? r.right - r.left : 0);
                }
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
                        aria-label={tab.dirty ? `${tab.name} (unsaved changes)` : tab.name}
                        // Reordering on a phone goes through the long-press
                        // menu; desktop drags with pointer events (TABS-24).
                        onKeyDown={(e) => onKeyDown(e, index)}
                        onPointerDown={(e) => onPointerDown(e, tab.id, index)}
                        onPointerMove={onPointerMove}
                        onPointerUp={(e) => { endMouseDrag(e, true); clearLongPress(); }}
                        onPointerCancel={(e) => { endMouseDrag(e, false); clearLongPress(); }}
                        onClick={() => {
                            // Swallow the tap that follows a fired long-press.
                            if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                            }
                            onSelect(tab.id);
                            // A mouse click on a tab means "show me this
                            // note": focus goes to the note, as in VS Code.
                            // It used to stay on the tab, so typing did
                            // nothing and Backspace/Delete (the tab strip's
                            // keyboard close keys) CLOSED the tab. Keyboard
                            // navigation of the strip keeps focus. FOCUS-01.
                            window.dispatchEvent(new CustomEvent("paperling:focus-document"));
                        }}
                        onMouseDown={(e) => {
                            // Middle-click closes, like a browser.
                            if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
                        }}
                        onContextMenu={(e) => {
                            if (!onContextMenu) return;
                            e.preventDefault();
                            onContextMenu(tab.id, e.clientX, e.clientY);
                        }}
                        className={`group/tab relative flex items-center gap-2 pl-3 pr-2 shrink-0 min-w-[110px] max-w-[200px] ${isDragged ? "cursor-grabbing z-10 shadow-md bg-[var(--bg-primary)]" : "cursor-pointer"} border-r border-[var(--border)] outline-none ${
                            isActive
                                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                        style={{
                            transform: offset ? `translateX(${offset}px)` : undefined,
                            // The dragged tab tracks the pointer 1:1; the others
                            // glide aside. Nothing animates on the drop frame.
                            transition: isDragged || settling
                                ? "none"
                                : dragIndex !== null
                                    ? "transform 150ms ease"
                                    : "background-color 150ms, color 150ms",
                        }}
                    >
                        {/* Active-tab top accent */}
                        {isActive && <span className="absolute left-0 top-0 h-[2px] w-full bg-[var(--accent)]" aria-hidden="true" />}
                        <span className="material-symbols-outlined text-[14px] shrink-0 opacity-70">description</span>
                        {/* Leading bullet mirrors the window title's unsaved
                            marker (• filename), so every dirty tab — active or
                            background — is identifiable at a glance and stays
                            indicated while hovered, unlike the trailing dot. */}
                        {/* Fixed-width slot, always laid out: inserting "• "
                            into the label made the tab wider on the first
                            keystroke, shifting every tab to its right (and
                            back on save). TABS-23. */}
                        <span className={`-mr-1 w-1.5 shrink-0 text-xs leading-none ${tab.dirty ? "" : "invisible"}`} aria-hidden="true">•</span>
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
