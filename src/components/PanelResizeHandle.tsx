import { useCallback, useEffect, useRef } from "react";

/**
 * Drag handle on the left edge of a right-anchored panel. Issue #111.
 *
 * Separate from SplitDivider, which resizes two in-flow panes and therefore
 * works in ratios. This one sizes a `fixed right-0` element, so it works in
 * pixels measured from the right edge of the window.
 *
 * `onResize` fires continuously while dragging (so layout tracks the pointer);
 * `onCommit` fires once on release, which is where persistence belongs — writing
 * on every pointermove would hit localStorage a hundred times a second.
 */
interface PanelResizeHandleProps {
    /** Current width in px, needed so keyboard nudges are relative. */
    width: number;
    min: number;
    max: number;
    onResize: (width: number) => void;
    onCommit: (width: number) => void;
    label: string;
}

/** One arrow press. Big enough to feel responsive, small enough to be precise. */
const NUDGE_PX = 16;

export function PanelResizeHandle({ width, min, max, onResize, onCommit, label }: PanelResizeHandleProps) {
    const draggingRef = useRef(false);
    // Read in the pointerup handler, which must commit the last dragged value
    // without waiting for a re-render to land.
    const latestRef = useRef(width);
    latestRef.current = width;

    const clamp = useCallback(
        (px: number) => Math.min(max, Math.max(min, Math.round(px))),
        [min, max]
    );

    // Panel is anchored to the right edge, so its width is the distance from the
    // pointer to that edge.
    const widthFromPointer = useCallback(
        (clientX: number) => clamp(window.innerWidth - clientX),
        [clamp]
    );

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        onResize(widthFromPointer(e.clientX));
    }, [onResize, widthFromPointer]);

    const endDrag = useCallback((e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onCommit(latestRef.current);
    }, [onCommit]);

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Left grows the panel: it is on the panel's left edge, so dragging left
        // makes it wider, and the keys should match the drag direction.
        const delta = e.key === "ArrowLeft" ? NUDGE_PX : e.key === "ArrowRight" ? -NUDGE_PX : 0;
        if (!delta) return;
        e.preventDefault();
        const next = clamp(latestRef.current + delta);
        onResize(next);
        onCommit(next);
    }, [clamp, onResize, onCommit]);

    // A drag interrupted by an unmount (panel closed mid-drag) would otherwise
    // leave the whole document stuck with a resize cursor and no selection.
    useEffect(() => () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    }, []);

    return (
        <div
            role="separator"
            aria-label={label}
            aria-orientation="vertical"
            aria-valuenow={width}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            // Sits just outside the panel's left border and stretches full
            // height. Wider than it looks so it is easy to grab (#111).
            className="absolute left-0 top-0 bottom-0 -translate-x-1/2 w-2 z-10 cursor-col-resize group focus:outline-none"
        >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-transparent group-hover:bg-[var(--accent)] group-active:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)] transition-colors" />
        </div>
    );
}
