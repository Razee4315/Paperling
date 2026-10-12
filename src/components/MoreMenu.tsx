import { useState, useRef, useEffect } from 'react';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { formatShortcut } from '../config/keybindings';

interface MoreMenuProps {
    onOpenFolder?: () => void;
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
 * The "More" (⋯) dropdown in the title bar. CHROME-04: the bar had grown to a
 * folder icon, New, Open, Save, Find, Export, AI and an Edit button, which is
 * more than anyone scans. The everyday actions (New, Open, Save, Export) stay
 * as buttons; everything a mouse user needs less often lives here, so nothing
 * depends on knowing a shortcut. Mirrors the ExportMenu/SettingsMenu dropdown
 * pattern (useDropdownKeyboard + outside-click/Escape close); shortcut labels
 * come from the central keybinding config.
 */
export function MoreMenu({ onOpenFolder, onFind, onReplace, onFindInFiles, onSaveAs, onPrint }: MoreMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const onMenuKeyDown = useDropdownKeyboard(isOpen, panelRef, () => setIsOpen(false));

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
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
        setIsOpen(false);
        action();
    };

    const items: MoreMenuItem[] = [
        ...(onOpenFolder ? [{ label: 'Open folder…', icon: 'folder_open', action: onOpenFolder }] : []),
        { label: 'Find', icon: 'search', shortcut: formatShortcut('find'), action: onFind, dividerBefore: !!onOpenFolder },
        { label: 'Find and Replace', icon: 'find_replace', shortcut: formatShortcut('replace'), action: onReplace },
        { label: 'Find in Files…', icon: 'manage_search', shortcut: formatShortcut('searchInFolder'), action: onFindInFiles },
        ...(onSaveAs ? [{ label: 'Save As…', icon: 'save_as', shortcut: formatShortcut('saveAs'), action: onSaveAs, dividerBefore: true }] : []),
        ...(onPrint ? [{ label: 'Print…', icon: 'print', action: onPrint, dividerBefore: !onSaveAs }] : []),
    ];

    return (
        <div ref={menuRef} className="relative no-drag">
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-label="More actions"
                aria-expanded={isOpen}
                aria-haspopup="true"
                className="chrome-btn flex items-center justify-center w-8 h-8"
                title="More: open folder, find, save as, print"
            >
                <span className="material-symbols-outlined text-[18px]">more_horiz</span>
            </button>

            {isOpen && (
                <div
                    ref={panelRef}
                    onKeyDown={onMenuKeyDown}
                    role="menu"
                    aria-label="More actions"
                    className="absolute right-0 top-full mt-1 w-60 py-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden z-[70] animate-fade-in-down"
                >
                    {items.map((it) => (
                        <div key={it.label}>
                            {it.dividerBefore && <div className="h-px my-1 bg-[var(--border)]" role="separator" />}
                            <button
                                role="menuitem"
                                onClick={() => run(it.action)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--bg-hover)] transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px] w-5 text-center text-[var(--text-secondary)]" aria-hidden="true">{it.icon}</span>
                                <span className="flex-1">{it.label}</span>
                                {it.shortcut && <kbd className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{it.shortcut}</kbd>}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
