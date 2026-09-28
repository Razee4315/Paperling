import { useLayoutEffect, useRef, useState } from "react";
import type { Align, TableOp } from "../utils/tableModel";

interface TableToolbarProps {
    /** Anchor pixel position: top-left of the table's first line. Null hides it. */
    anchor: { x: number; y: number } | null;
    /** Alignment of the column the caret is in, so the active button can light up. */
    activeAlign: Align;
    /** Run a table operation against the table under the caret. */
    onOp: (op: TableOp) => void;
}

interface Btn {
    op: TableOp;
    icon: string;
    title: string;
}

const ROW_BTNS: Btn[] = [
    { op: { kind: "row-above" }, icon: "arrow_upward", title: "Insert row above" },
    { op: { kind: "row-below" }, icon: "arrow_downward", title: "Insert row below" },
    { op: { kind: "row-delete" }, icon: "delete", title: "Delete row" },
];
const COL_BTNS: Btn[] = [
    { op: { kind: "col-left" }, icon: "arrow_back", title: "Insert column left" },
    { op: { kind: "col-right" }, icon: "arrow_forward", title: "Insert column right" },
    { op: { kind: "col-delete" }, icon: "delete", title: "Delete column" },
];
const ALIGN_BTNS: Array<Btn & { align: Align }> = [
    { op: { kind: "align", align: "left" }, align: "left", icon: "format_align_left", title: "Align column left" },
    { op: { kind: "align", align: "center" }, align: "center", icon: "format_align_center", title: "Align column center" },
    { op: { kind: "align", align: "right" }, align: "right", icon: "format_align_right", title: "Align column right" },
];

export function TableToolbar({ anchor, activeAlign, onOp }: TableToolbarProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null);

    // Keep the bar inside the viewport, floating just above the table; flip below
    // the first row if there isn't room above. Mirrors AIBubble's measure pass.
    useLayoutEffect(() => {
        if (!anchor || !ref.current) return;
        const margin = 8;
        const rect = ref.current.getBoundingClientRect();
        const vw = window.innerWidth;
        let left = anchor.x;
        if (left + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin);
        if (left < margin) left = margin;
        // Float just above the table, but never tuck under the ~48px app title
        // bar (where it would cover the window controls) for a top-of-doc table.
        const top = Math.max(48, anchor.y - rect.height - 6);
        setAdjusted({ left, top });
    }, [anchor]);

    if (!anchor) return null;

    // preventDefault on mousedown keeps the editor's selection (and DOM focus) so
    // the op acts on the right cell; onOp refocuses afterwards anyway.
    const hold = (e: React.MouseEvent) => e.preventDefault();

    const button = (b: Btn, active = false) => (
        <button
            key={b.title}
            type="button"
            title={b.title}
            aria-label={b.title}
            onMouseDown={hold}
            onClick={() => onOp(b.op)}
            className={`w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${
                active ? "bg-[var(--bg-hover)] text-[var(--accent)]" : "text-[var(--text-secondary)]"
            }`}
        >
            <span className="material-symbols-outlined text-[16px]">{b.icon}</span>
        </button>
    );

    const Divider = () => <span className="mx-0.5 h-5 w-px bg-[var(--border-subtle)]" aria-hidden="true" />;
    const GroupLabel = ({ children }: { children: string }) => (
        <span className="px-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] select-none">{children}</span>
    );

    return (
        <div
            ref={ref}
            role="toolbar"
            aria-label="Table editing"
            className="fixed z-[85] flex items-center gap-0.5 px-1.5 py-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-2xl animate-fade-in"
            style={{
                left: adjusted?.left ?? anchor.x,
                top: adjusted?.top ?? anchor.y,
                visibility: adjusted ? "visible" : "hidden",
            }}
        >
            <GroupLabel>Row</GroupLabel>
            {ROW_BTNS.map((b) => button(b))}
            <Divider />
            <GroupLabel>Col</GroupLabel>
            {COL_BTNS.map((b) => button(b))}
            <Divider />
            {ALIGN_BTNS.map((b) => button(b, activeAlign === b.align))}
            <Divider />
            {button({ op: { kind: "format" }, icon: "grid_on", title: "Tidy table (align columns)" })}
        </div>
    );
}
