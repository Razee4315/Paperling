import { useEffect, useRef } from "react";

export interface TabMenuAction {
    label: string;
    icon: string;
    onClick: () => void;
    disabled?: boolean;
    /** Renders a thin separator above this item. */
    dividerBefore?: boolean;
}

interface TabContextMenuProps {
    x: number;
    y: number;
    actions: TabMenuAction[];
    onClose: () => void;
}

/**
 * Small floating menu for a tab's right-click actions (close variants, copy
 * path, reveal). Closes on outside click, Escape, scroll, or blur. TABS-12.
 */
export function TabContextMenu({ x, y, actions, onClose }: TabContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        window.addEventListener("blur", onClose);
        window.addEventListener("resize", onClose);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("blur", onClose);
            window.removeEventListener("resize", onClose);
        };
    }, [onClose]);

    // Keep the menu on-screen: nudge left/up if it would overflow the viewport.
    const width = 220;
    const left = Math.min(x, window.innerWidth - width - 8);
    const top = Math.min(y, window.innerHeight - actions.length * 34 - 8);

    return (
        <div
            ref={ref}
            role="menu"
            style={{ left, top, width }}
            className="fixed z-[120] py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl text-sm no-select"
        >
            {actions.map((a, i) => (
                <div key={i}>
                    {a.dividerBefore && <div className="my-1 border-t border-[var(--border)]" />}
                    <button
                        role="menuitem"
                        disabled={a.disabled}
                        onClick={() => { a.onClick(); onClose(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[var(--text-secondary)] enabled:hover:bg-[var(--bg-hover)] enabled:hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-default transition-colors"
                    >
                        <span className="material-symbols-outlined text-[16px] shrink-0">{a.icon}</span>
                        <span className="truncate">{a.label}</span>
                    </button>
                </div>
            ))}
        </div>
    );
}
