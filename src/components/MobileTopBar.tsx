import { useEffect, useRef } from "react";

interface MenuItem {
    id: string;
    label: string;
    icon: string;
    onSelect: () => void;
    /** Separator drawn above this item. */
    dividerBefore?: boolean;
}

interface MobileTopBarProps {
    fileName: string | null;
    isDirty: boolean;
    onOpenMenu: () => void;
    onOpenPalette: () => void;
}

/**
 * The phone's app bar — replaces the desktop TitleBar on mobile. A desktop
 * title bar is window chrome (drag region, minimize/maximize/close); Android
 * owns all of that at the OS level, so this bar is pure app navigation:
 * menu (sheet), file name + dirty dot, command palette.
 *
 * Height is `--mobile-topbar-h` (48px + the status-bar safe inset) so the
 * fixed panels, which offset from the same variable, line up below it.
 */
export function MobileTopBar({ fileName, isDirty, onOpenMenu, onOpenPalette }: MobileTopBarProps) {
    return (
        <header
            className="shrink-0 flex items-center gap-1 bg-[var(--bg-titlebar)] border-b border-[var(--border)] px-1 no-select z-[60]"
            // Height includes the status-bar inset, and that inset is applied as
            // TOP PADDING (border-box), so the buttons sit centered in the lower
            // 48dp strip — directly below the status bar with real breathing
            // room, never inside/beside it (the "controls too high" report).
            style={{ height: "var(--mobile-topbar-h)", paddingTop: "var(--safe-area-top)" }}
        >
            <button
                onClick={onOpenMenu}
                aria-label="Menu"
                aria-haspopup="menu"
                className="flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            >
                <span className="material-symbols-outlined text-[22px]">menu</span>
            </button>

            <div className="flex-1 min-w-0 flex items-center justify-center gap-2 px-1">
                {fileName ? (
                    <>
                        {/* The dirty dot mirrors the desktop title bar's bullet so
                            the "unsaved" meaning is consistent across shells. */}
                        {isDirty && (
                            <span
                                className="w-2 h-2 rounded-full bg-[var(--status-unsaved)] shrink-0"
                                aria-label="Unsaved changes"
                                role="img"
                            />
                        )}
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{fileName}</span>
                    </>
                ) : (
                    <span className="text-sm font-medium text-[var(--text-secondary)]">Paperling</span>
                )}
            </div>

            <button
                onClick={onOpenPalette}
                aria-label="Search commands and notes"
                className="flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            >
                <span className="material-symbols-outlined text-[22px]">search</span>
            </button>
        </header>
    );
}

/**
 * The menu sheet the ☰ button opens. Rendered by App (which owns the action
 * callbacks); positioned under the app bar, full-width, ≥44px rows.
 */
export function MobileMenu({ open, items, onClose }: { open: boolean; items: MenuItem[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="mobile-menu fixed inset-x-0 bottom-0 top-[var(--mobile-topbar-h)] z-[70] bg-black/40" onClick={onClose}>
            <div
                ref={ref}
                role="menu"
                aria-label="App menu"
                className="absolute left-2 top-2 w-[min(300px,calc(100vw-1rem))] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl py-1.5 animate-fade-in-down overflow-y-auto max-h-[calc(100dvh-var(--mobile-topbar-h)-1rem)]"
                onClick={(e) => e.stopPropagation()}
            >
                {items.map((item) => (
                    <div key={item.id} className={item.dividerBefore ? "border-t border-[var(--border)] my-1" : ""}>
                        <button
                            role="menuitem"
                            onClick={() => {
                                onClose();
                                item.onSelect();
                            }}
                            className="w-full flex items-center gap-3 px-4 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] transition-colors"
                            style={{ minHeight: 44 }}
                        >
                            <span className="material-symbols-outlined text-[20px] text-[var(--text-secondary)] shrink-0">{item.icon}</span>
                            <span className="truncate">{item.label}</span>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
