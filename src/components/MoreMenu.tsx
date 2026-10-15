import { useState, useRef, useEffect } from 'react';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { formatShortcut } from '../config/keybindings';

interface MoreMenuProps {
    onOpenFolder?: () => void;
    onOpenRecent?: (path: string) => void;
    /** Open the find bar in the current view (editor or reader). */
    onFind: () => void;
    /** Open find-and-replace (editor). */
    onReplace: () => void;
    /** Open cross-file search. */
    onFindInFiles: () => void;
    onSaveAs?: () => void;
    onPrint?: () => void;
}

interface MoreMenuItem {
    label: string;
    icon: string;
    shortcut?: string;
    action: () => void;
    /** Thin rule above this item: groups files / find / output. */
    dividerBefore?: boolean;
}

/**
 * The "More" / Options (⋯) dropdown in the title bar. CHROME-04: the bar had grown to a
 * folder icon, New, Open, Save, Find, Export, AI and an Edit button, which is
 * more than anyone scans. The everyday actions (New, Open, Save, Export) stay
 * as buttons; everything a mouse user needs less often lives here, so nothing
 * depends on knowing a shortcut. Mirrors the ExportMenu/SettingsMenu dropdown
 * pattern (useDropdownKeyboard + outside-click/Escape close); shortcut labels
 * come from the central keybinding config.
 */
export function MoreMenu({
    onOpenFolder,
    onOpenRecent: _onOpenRecent,
    onFind,
    onReplace,
    onFindInFiles,
    onSaveAs,
    onPrint,
}: MoreMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isRecentOpen, setIsRecentOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const recentItemRef = useRef<HTMLDivElement>(null);
    const recentButtonRef = useRef<HTMLButtonElement>(null);
    const onMenuKeyDown = useDropdownKeyboard(isOpen, panelRef, () => {
        setIsRecentOpen(false);
        setIsOpen(false);
    });

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsRecentOpen(false);
                setIsOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsRecentOpen(false);
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKey);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen]);

    const run = (action: () => void) => {
        setIsRecentOpen(false);
        setIsOpen(false);
        action();
    };

    const findAndOutputItems: MoreMenuItem[] = [
        { label: 'Find', icon: 'search', shortcut: formatShortcut('find'), action: onFind },
        { label: 'Find and Replace', icon: 'find_replace', shortcut: formatShortcut('replace'), action: onReplace },
        { label: 'Find in Files…', icon: 'manage_search', shortcut: formatShortcut('searchInFolder'), action: onFindInFiles },
        ...(onSaveAs ? [{ label: 'Save As…', icon: 'save_as', shortcut: formatShortcut('saveAs'), action: onSaveAs, dividerBefore: true }] : []),
        ...(onPrint ? [{ label: 'Print…', icon: 'print', action: onPrint, dividerBefore: !onSaveAs }] : []),
    ];

    return (
        <div ref={menuRef} className="relative no-drag">
            <button
                onClick={() => {
                    const next = !isOpen;
                    if (!next) setIsRecentOpen(false);
                    setIsOpen(next);
                }}
                aria-label="Options"
                aria-expanded={isOpen}
                aria-haspopup="true"
                className="chrome-btn flex items-center justify-center w-8 h-8"
                title="Options: open folder, recent files, find, save as, print"
            >
                <span className="material-symbols-outlined text-[18px]">more_horiz</span>
            </button>

            {isOpen && (
                <div
                    ref={panelRef}
                    onKeyDown={onMenuKeyDown}
                    role="menu"
                    aria-label="Options"
                    className="absolute right-0 top-full mt-1 w-60 p-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-xl z-[70] animate-fade-in-down"
                >
                    {onOpenFolder && (
                        <button
                            role="menuitem"
                            onClick={() => run(onOpenFolder)}
                            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-left rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px] w-5 text-center text-[var(--text-secondary)]" aria-hidden="true">
                                folder_open
                            </span>
                            <span className="flex-1">Open folder…</span>
                        </button>
                    )}

                    {/* Recent item directly below Open folder */}
                    <div ref={recentItemRef} className="relative">
                        <button
                            ref={recentButtonRef}
                            role="menuitem"
                            aria-haspopup="true"
                            aria-expanded={isRecentOpen}
                            onClick={() => setIsRecentOpen((prev) => !prev)}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-left rounded-lg transition-colors ${
                                isRecentOpen ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'hover:bg-[var(--bg-hover)]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px] w-5 text-center text-[var(--text-secondary)]" aria-hidden="true">
                                history
                            </span>
                            <span className="flex-1">Recent</span>
                            <span className="material-symbols-outlined text-[16px] text-[var(--text-muted)]" aria-hidden="true">
                                chevron_right
                            </span>
                        </button>
                    </div>

                    <div className="h-px my-1 bg-[var(--border)]" role="separator" />

                    {findAndOutputItems.map((it) => (
                        <div key={it.label}>
                            {it.dividerBefore && <div className="h-px my-1 bg-[var(--border)]" role="separator" />}
                            <button
                                role="menuitem"
                                onClick={() => run(it.action)}
                                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-left rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px] w-5 text-center text-[var(--text-secondary)]" aria-hidden="true">
                                    {it.icon}
                                </span>
                                <span className="flex-1">{it.label}</span>
                                {it.shortcut && (
                                    <kbd className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                                        {it.shortcut}
                                    </kbd>
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
