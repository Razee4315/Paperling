import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
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
    const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});

    const menuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const recentItemRef = useRef<HTMLDivElement>(null);
    const recentButtonRef = useRef<HTMLButtonElement>(null);
    const submenuRef = useRef<HTMLDivElement>(null);
    const closeTimerRef = useRef<number | null>(null);
    const focusRecentRef = useRef(false);

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

    // CHROME-06: at the supported 600px window width neither side may fit a
    // 288px fly-out. Clamp to the viewport instead of losing recent filenames
    // offscreen, and shrink its scroll area in short windows.
    const updateSubmenuPosition = useCallback(() => {
        if (!recentItemRef.current) return;
        const rect = recentItemRef.current.getBoundingClientRect();
        const margin = 8;
        const width = Math.min(288, Math.max(0, window.innerWidth - margin * 2));
        const fitsRight = rect.right + 4 + width <= window.innerWidth - margin;
        const side = fitsRight ? 'right' : 'left';
        const desiredLeft = fitsRight ? rect.right + 4 : rect.left - width - 4;
        const left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - width - margin));
        // If clamping overlaps the trigger, put the menu below the row.
        // Otherwise the hover-open panel can put a file under the user's click.
        const top = left < rect.right && left + width > rect.left ? rect.height + 4 : 0;
        setSubmenuSide(side);
        setSubmenuStyle({
            left: left - rect.left,
            top,
            width,
            maxHeight: Math.max(0, Math.min(320, window.innerHeight - rect.top - top - margin)),
        });
    }, []);

    const openRecentSubmenu = useCallback((focus = false) => {
        clearCloseTimer();
        focusRecentRef.current = focus;
        setRecentFiles(getRecentFiles());
        updateSubmenuPosition();
        setIsRecentOpen(true);
    }, [clearCloseTimer, updateSubmenuPosition]);

    useLayoutEffect(() => {
        if (!isRecentOpen || !focusRecentRef.current) return;
        focusRecentRef.current = false;
        const submenu = submenuRef.current;
        (submenu?.querySelector<HTMLButtonElement>('button:not([disabled])') ?? submenu)?.focus();
    });

    useEffect(() => {
        if (!isRecentOpen) return;
        let frame: number | null = null;
        const handleResize = () => {
            updateSubmenuPosition();
            // CHROME-06: the title-bar controls can reflow after the resize
            // event (responsive labels / host viewport updates). Measure again
            // on the next frame so the offset uses their settled position.
            if (frame !== null) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                frame = null;
                updateSubmenuPosition();
            });
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [isRecentOpen, updateSubmenuPosition]);

    const closeRecentSubmenu = useCallback(() => {
        clearCloseTimer();
        focusRecentRef.current = false;
        // A pointer departure must not strand keyboard focus in a removed menu.
        if (submenuRef.current?.contains(document.activeElement)) recentButtonRef.current?.focus();
        setIsRecentOpen(false);
    }, [clearCloseTimer]);

    const handleRecentMouseEnter = useCallback(() => {
        openRecentSubmenu();
    }, [openRecentSubmenu]);

    const handleRecentMouseLeave = useCallback(() => {
        clearCloseTimer();
        // 150ms bridge timeout so moving between parent item and submenu is seamless
        closeTimerRef.current = window.setTimeout(closeRecentSubmenu, 150);
    }, [clearCloseTimer, closeRecentSubmenu]);

    const handleOtherItemMouseEnter = closeRecentSubmenu;

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

    const handleRecentKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            openRecentSubmenu(true);
        }
    };

    // CHROME-06: only navigate the current menu level. The shared dropdown
    // hook intentionally supports flat panels; its recursive button query
    // would otherwise include this fly-out and send Home/End to the parent.
    const navigateMenu = (e: React.KeyboardEvent, menu: HTMLDivElement | null) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !menu) return false;
        e.preventDefault();
        e.stopPropagation();
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
            .filter((item) => item.closest('[role="menu"]') === menu);
        if (items.length === 0) return true;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'Home' ? 0
            : e.key === 'End' ? items.length - 1
            : e.key === 'ArrowDown' ? (current + 1) % items.length
            : current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        items[next].focus();
        return true;
    };

    const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (navigateMenu(e, panelRef.current)) {
            closeRecentSubmenu();
            return;
        }
        onMenuKeyDown(e);
    };

    const handleSubmenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowLeft' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeRecentSubmenu();
            recentButtonRef.current?.focus();
            return;
        }
        navigateMenu(e, submenuRef.current);
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
                    onKeyDown={handleMenuKeyDown}
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
                    {onOpenRecent && <div
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
                            // Hover has already opened this on desktop: clicking must
                            // keep it open and enter it, not toggle it closed. CHROME-06.
                            onClick={() => openRecentSubmenu(true)}
                            onKeyDown={handleRecentKeyDown}
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
                                tabIndex={-1}
                                aria-label="Recent files"
                                onKeyDown={handleSubmenuKeyDown}
                                onMouseEnter={clearCloseTimer}
                                onMouseLeave={handleRecentMouseLeave}
                                style={submenuStyle}
                                className="absolute top-0 overflow-y-auto p-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl z-[80]"
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
                    </div>}

                    {(onOpenFolder || onOpenRecent) && <div className="h-px my-1 bg-[var(--border)]" role="separator" />}

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
