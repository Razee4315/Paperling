import { useState, useRef, useEffect } from 'react';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { formatShortcut } from '../config/keybindings';

interface EditMenuProps {
    /** Open the find bar in the current view (editor or reader). */
    onFind: () => void;
    /** Open find-and-replace (editor). */
    onReplace: () => void;
    /** Open cross-file search. */
    onFindInFiles: () => void;
}

interface EditMenuItem {
    label: string;
    icon: string;
    shortcut: string;
    action: () => void;
}

/**
 * The "Edit" dropdown in the title bar — the non-keyboard home for Find,
 * Find & Replace, and Find in Files. Mirrors the ExportMenu/SettingsMenu
 * dropdown pattern (useDropdownKeyboard + outside-click/Escape close). The
 * shortcut labels come from the central keybinding config, so they show ⌘F/⌘H
 * on macOS and Ctrl+F/Ctrl+H elsewhere, matching what actually fires.
 */
export function EditMenu({ onFind, onReplace, onFindInFiles }: EditMenuProps) {
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

    const items: EditMenuItem[] = [
        { label: 'Find', icon: 'search', shortcut: formatShortcut('find'), action: onFind },
        { label: 'Find and Replace', icon: 'find_replace', shortcut: formatShortcut('replace'), action: onReplace },
        { label: 'Find in Files…', icon: 'manage_search', shortcut: formatShortcut('searchInFolder'), action: onFindInFiles },
    ];

    return (
        <div ref={menuRef} className="relative no-drag">
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Edit menu"
                aria-expanded={isOpen}
                aria-haspopup="true"
                className="btn-press flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                title="Edit"
            >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span className="hidden sm:inline">Edit</span>
            </button>

            {isOpen && (
                <div
                    ref={panelRef}
                    onKeyDown={onMenuKeyDown}
                    role="menu"
                    aria-label="Edit"
                    className="absolute left-0 top-full mt-1 w-56 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden z-[70] animate-fade-in-down"
                >
                    {items.map((it) => (
                        <button
                            key={it.label}
                            role="menuitem"
                            onClick={() => run(it.action)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--bg-hover)] transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px] w-5 text-center text-[var(--text-secondary)]" aria-hidden="true">{it.icon}</span>
                            <span className="flex-1">{it.label}</span>
                            <kbd className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{it.shortcut}</kbd>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
