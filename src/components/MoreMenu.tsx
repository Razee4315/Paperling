import { useState, useRef, useEffect, useCallback } from 'react';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { formatShortcut } from '../config/keybindings';
import { getRecentFiles, type RecentFile } from '../utils/persistence';

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
    onOpenRecent,
    onFind,
    onReplace,
    onFindInFiles,
    onSaveAs,
    onPrint,
}: MoreMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isRecentOpen, setIsRecentOpen] = useState(false);
    const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
    const [submenuSide, setSubmenuSide] = useState<'right' | 'left'>('right');

    const menuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const recentItemRef = useRef<HTMLDivElement>(null);
    const recentButtonRef = useRef<HTMLButtonElement>(null);
    const submenuRef = useRef<HTMLDivElement>(null);
    const closeTimerRef = useRef<number | null>(null);

    const onMenuKeyDown = useDropdownKeyboard(isOpen, panelRef, () => {
        setIsRecentOpen(false);
        setIsOpen(false);
    });

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current !== null) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    const updateSubmenuSide = useCallback(() => {
        if (recentItemRef.current) {
            const rect = recentItemRef.current.getBoundingClientRect();
            // Submenu width is ~280px (w-72), plus a buffer
            if (rect.right + 280 > window.innerWidth && rect.left >= 280) {
                setSubmenuSide('left');
            } else {
                setSubmenuSide('right');
            }
        }
    }, []);

    const openRecentSubmenu = useCallback(() => {
        clearCloseTimer();
        setRecentFiles(getRecentFiles());
        updateSubmenuSide();
        setIsRecentOpen(true);
    }, [clearCloseTimer, updateSubmenuSide]);

    const handleRecentMouseEnter = useCallback(() => {
        openRecentSubmenu();
    }, [openRecentSubmenu]);

    const handleRecentMouseLeave = useCallback(() => {
        clearCloseTimer();
        // 150ms bridge timeout so moving between parent item and submenu is seamless
        closeTimerRef.current = setTimeout(() => {
            setIsRecentOpen(false);
        }, 150) as unknown as number;
    }, [clearCloseTimer]);

    const handleOtherItemMouseEnter = useCallback(() => {
        clearCloseTimer();
        setIsRecentOpen(false);
    }, [clearCloseTimer]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                clearCloseTimer();
                setIsRecentOpen(false);
                setIsOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                clearCloseTimer();
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
            clearCloseTimer();
        };
    }, [isOpen, clearCloseTimer]);

    const run = (action: () => void) => {
        clearCloseTimer();
        setIsRecentOpen(false);
        setIsOpen(false);
        action();
    };

    const handleSelectRecent = (path: string) => {
        clearCloseTimer();
        setIsRecentOpen(false);
        setIsOpen(false);
        onOpenRecent?.(path);
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
                    if (!next) {
                        clearCloseTimer();
                        setIsRecentOpen(false);
                    }
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
                            onMouseEnter={handleOtherItemMouseEnter}
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
                    <div
                        ref={recentItemRef}
                        className="relative"
                        onMouseEnter={handleRecentMouseEnter}
                        onMouseLeave={handleRecentMouseLeave}
                    >
                        <button
                            ref={recentButtonRef}
                            role="menuitem"
                            aria-haspopup="true"
                            aria-expanded={isRecentOpen}
                            onClick={() => {
                                if (isRecentOpen) {
                                    setIsRecentOpen(false);
                                } else {
                                    openRecentSubmenu();
                                }
                            }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-left rounded-lg transition-colors ${
                                isRecentOpen ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'hover:bg-[var(--bg-hover)]'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px] w-5 text-center text-[var(--text-secondary)]" aria-hidden="true">
                                history
                            </span>
                            <span className="flex-1">Recent</span>
                            <span className="material-symbols-outlined text-[16px] text-[var(--text-muted)]" aria-hidden="true">
                                {submenuSide === 'left' ? 'chevron_left' : 'chevron_right'}
                            </span>
                        </button>

                        {/* Secondary Submenu displaying list of recent files */}
                        {isRecentOpen && (
                            <div
                                ref={submenuRef}
                                role="menu"
                                aria-label="Recent files"
                                onMouseEnter={clearCloseTimer}
                                onMouseLeave={handleRecentMouseLeave}
                                className={`absolute top-0 w-72 max-h-80 overflow-y-auto p-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl z-[80] animate-fade-in-down ${
                                    submenuSide === 'right' ? 'left-full ml-1' : 'right-full mr-1'
                                }`}
                            >
                                {recentFiles.length === 0 ? (
                                    <div className="px-3 py-3 text-xs text-[var(--text-muted)] italic text-center">
                                        No recent files
                                    </div>
                                ) : (
                                    recentFiles.map((file) => (
                                        <button
                                            key={file.path}
                                            role="menuitem"
                                            onClick={() => handleSelectRecent(file.path)}
                                            title={file.path}
                                            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left rounded-lg hover:bg-[var(--bg-hover)] transition-colors group"
                                        >
                                            <span
                                                className={`material-symbols-outlined text-[18px] w-5 text-center shrink-0 ${
                                                    file.pinned ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                                                }`}
                                                aria-hidden="true"
                                            >
                                                {file.pinned ? 'push_pin' : 'description'}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="truncate text-sm font-medium text-[var(--text-primary)] leading-snug">
                                                    {file.name}
                                                </div>
                                                <div className="truncate text-[11px] text-[var(--text-muted)] font-mono leading-tight">
                                                    {file.path}
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    <div className="h-px my-1 bg-[var(--border)]" role="separator" />

                    {findAndOutputItems.map((it) => (
                        <div key={it.label}>
                            {it.dividerBefore && <div className="h-px my-1 bg-[var(--border)]" role="separator" />}
                            <button
                                role="menuitem"
                                onMouseEnter={handleOtherItemMouseEnter}
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
