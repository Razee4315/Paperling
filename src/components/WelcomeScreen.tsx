import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { clearRecentFiles, getRecentFiles, removeRecentFile, type RecentFile } from "../utils/persistence";
import { IS_MOBILE } from "../utils/platform";
import { MascotIdle } from "./MascotIdle";

interface WelcomeScreenProps {
    onOpenFile: () => void;
    onNewFile?: () => void;
    onOpenSettings?: () => void;
    onFileDrop: (path: string) => void;
    onOpenRecent?: (path: string) => void;
}

const formatRelative = (ts: number): string => {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 60 * min, day = 24 * hr;
    if (diff < min) return "just now";
    if (diff < hr) return `${Math.floor(diff / min)}m ago`;
    if (diff < day) return `${Math.floor(diff / hr)}h ago`;
    if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
    return new Date(ts).toLocaleDateString();
};

const parentFolderOf = (path: string): string => {
    const norm = path.replace(/\\/g, "/");
    const segs = norm.split("/").slice(0, -1);
    return segs.slice(-2).join("/") || segs.join("/");
};

export function WelcomeScreen({ onOpenFile, onNewFile, onOpenSettings, onFileDrop, onOpenRecent }: WelcomeScreenProps) {
    const [recents, setRecents] = useState<RecentFile[]>([]);
    const [missing, setMissing] = useState<Set<string>>(new Set());
    // Highlight while a markdown file is dragged over the welcome screen so
    // the user gets immediate visual confirmation that the drop will be
    // handled. Reset on drop / dragleave.
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const list = getRecentFiles();
        setRecents(list);
        // Quick existence check for each — gray out missing entries
        let cancelled = false;
        Promise.all(
            list.map(async (f) => {
                try {
                    await invoke("get_file_info", { path: f.path });
                    return null;
                } catch {
                    return f.path;
                }
            })
        ).then((results) => {
            if (cancelled) return;
            setMissing(new Set(results.filter((p): p is string => !!p)));
        });
        return () => { cancelled = true; };
    }, []);

    // Drag highlight via the NATIVE Tauri drag events. With Tauri's drag-drop
    // handling enabled, the webview never receives HTML5 drag events on
    // Windows — so the dashed-outline feedback below only worked in browser
    // dev mode. These listeners light it up in the real app too; the HTML5
    // handlers stay as the browser-dev fallback.
    useEffect(() => {
        let mounted = true;
        let unlistens: Array<() => void> = [];
        Promise.all([
            listen(TauriEvent.DRAG_ENTER, () => setIsDragging(true)),
            listen(TauriEvent.DRAG_LEAVE, () => setIsDragging(false)),
            listen(TauriEvent.DRAG_DROP, () => setIsDragging(false)),
        ]).then((fns) => {
            if (mounted) unlistens = fns;
            else fns.forEach((f) => f());
        }).catch(() => {/* browser dev mode — HTML5 handlers cover it */});
        return () => {
            mounted = false;
            unlistens.forEach((f) => f());
        };
    }, []);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only reset when the drag leaves the outer container, not when it
        // crosses into a child element.
        if (e.currentTarget === e.target) setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            // @ts-expect-error - Tauri adds path to File objects
            const path = file.path || file.name;
            if (path.endsWith('.md') || path.endsWith('.markdown')) {
                onFileDrop(path);
            }
        }
    };

    const handleRemoveRecent = (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        e.preventDefault();
        setRecents(removeRecentFile(path));
    };

    const handleClearAll = () => {
        clearRecentFiles();
        setRecents([]);
        setMissing(new Set());
    };

    return (
        <main
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            // `justify-start` (not `justify-center`) plus generous vertical
            // padding keeps the logo anchored at the top of the visible area
            // when the Recents list grows tall enough for the page to scroll.
            // With `justify-center` + `overflow-y-auto` the centered content
            // can be taller than the viewport, which causes flexbox to push
            // the top edge (the logo) above the scrollable area — invisible
            // unless the user scrolls up.
            className={`flex-1 flex flex-col items-center justify-start py-10 px-6 no-select overflow-y-auto transition-colors ${isDragging ? "bg-[var(--bg-hover)] outline outline-2 outline-dashed outline-[var(--accent)] -outline-offset-8" : ""}`}
            aria-dropeffect="copy"
        >
            <div className="flex flex-col items-center gap-8 max-w-md w-full text-center animate-fade-in-up">
                <div className="flex items-center justify-center w-28 h-28">
                    <MascotIdle className="w-full h-full" />
                </div>

                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                        Paperling
                    </h1>
                    <p className="text-sm text-[var(--text-secondary)]">
                        A minimal markdown editor
                    </p>
                </div>

                <div className="flex gap-2 items-center">
                    <button
                        onClick={onOpenFile}
                        className="btn-press whitespace-nowrap flex items-center gap-2 bg-[var(--accent)] hover:opacity-90 text-[var(--accent-text)] font-medium text-sm px-5 py-2.5 rounded-[var(--radius-md)] transition-all duration-200"
                    >
                        <span className="material-symbols-outlined text-[20px]">folder_open</span>
                        <span>{IS_MOBILE ? "Open" : "Open File"}</span>
                    </button>
                    {onNewFile && (
                        <button
                            onClick={onNewFile}
                            className="btn-press whitespace-nowrap flex items-center gap-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border)] font-medium text-sm px-5 py-2.5 rounded-[var(--radius-md)] transition-all duration-200"
                        >
                            <span className="material-symbols-outlined text-[20px]">edit_note</span>
                            <span>{IS_MOBILE ? "New" : "New File"}</span>
                        </button>
                    )}
                    {onOpenSettings && (
                        <button
                            onClick={onOpenSettings}
                            aria-label="Settings"
                            title="Settings (Ctrl+,)"
                            className="btn-press flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-all duration-200"
                        >
                            <span className="material-symbols-outlined text-[20px]">settings</span>
                        </button>
                    )}
                </div>

                <p className="text-xs text-[var(--text-muted)]">
                    {IS_MOBILE ? (
                        <>
                            Notes are stored <strong>on this device</strong>. Tap a recent file below, or use <span className="font-medium">Open</span> to browse.
                        </>
                    ) : (
                        <>
                            drag a <code className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-[var(--text-secondary)] border border-[var(--border)]">.md</code> file · press <kbd className="px-1 py-0.5 font-mono rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">Ctrl+P</kbd> for commands · <kbd className="px-1 py-0.5 font-mono rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">?</kbd> for shortcuts
                        </>
                    )}
                </p>

                {recents.length > 0 && onOpenRecent && (
                    <div className="w-full mt-4 text-left">
                        <div className="flex items-center justify-between mb-2 px-1">
                            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                                Recent
                            </div>
                            <button
                                onClick={handleClearAll}
                                aria-label="Clear all recent files"
                                title="Clear all recents"
                                className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors px-1.5 py-0.5 rounded"
                            >
                                Clear all
                            </button>
                        </div>
                        <ul className="flex flex-col">
                            {recents.map((f) => {
                                const isMissing = missing.has(f.path);
                                return (
                                <li key={f.path} className="group relative">
                                    {/* Two siblings instead of nested buttons:
                                        the previous form had a `<span
                                        role="button">` inside a `<button>`,
                                        which is invalid HTML — depending on
                                        browser, the click could bubble to
                                        the outer button and re-open the file
                                        right after the user removed it. */}
                                    <button
                                        onClick={() => !isMissing && onOpenRecent(f.path)}
                                        disabled={isMissing}
                                        className={`btn-press w-full flex items-center gap-3 px-3 pr-9 py-2 rounded-[var(--radius-md)] transition-colors text-left ${isMissing ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--bg-hover)]"}`}
                                        title={isMissing ? `${f.path} (missing)` : f.path}
                                    >
                                        <span className="material-symbols-outlined text-[18px] text-[var(--text-secondary)] shrink-0">
                                            {isMissing ? "broken_image" : "description"}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className={`text-sm truncate ${isMissing ? "line-through text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>{f.name}</div>
                                            <div className="text-[11px] text-[var(--text-muted)] truncate">{parentFolderOf(f.path)}</div>
                                        </div>
                                        <span className="text-[11px] text-[var(--text-muted)] tabular-nums shrink-0">{isMissing ? "missing" : formatRelative(f.openedAt)}</span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${f.name} from recents`}
                                        title="Remove from recents"
                                        onClick={(e) => handleRemoveRecent(e, f.path)}
                                        className={`absolute right-2 top-1/2 -translate-y-1/2 focus-visible:opacity-100 w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity flex items-center justify-center ${
                                            // A hover-only remove is unreachable on touch.
                                            IS_MOBILE ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                    </button>
                                </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </main>
    );
}
