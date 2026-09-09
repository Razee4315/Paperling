import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import mascotMagnify from "../assets/mascot/mascot-magnify.png";
import mascotReading from "../assets/mascot/mascot-reading.png";
import { attachFocusTrap } from "../utils/focusTrap";
import { IS_MOBILE } from "../utils/platform";

interface BacklinkMatch {
    line: number;
    text: string;
}

interface BacklinkResult {
    path: string;
    name: string;
    matches: BacklinkMatch[];
}

interface BacklinksPanelProps {
    isOpen: boolean;
    directory: string;
    currentFilePath: string;
    onFileSelect: (path: string, line: number) => void;
    onClose: () => void;
}

export function BacklinksPanel({
    isOpen,
    directory,
    currentFilePath,
    onFileSelect,
    onClose,
}: BacklinksPanelProps) {
    const [results, setResults] = useState<BacklinkResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const panelRef = useRef<HTMLElement>(null);

    const loadBacklinks = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const next = await invoke<BacklinkResult[]>("find_backlinks", {
                directory,
                targetFile: currentFilePath,
            });
            setResults(next);
        } catch (err) {
            setResults([]);
            setError(String(err));
        } finally {
            setIsLoading(false);
        }
    }, [currentFilePath, directory]);

    useEffect(() => {
        if (isOpen) void loadBacklinks();
    }, [isOpen, loadBacklinks]);

    useEffect(() => {
        if (!isOpen) return;
        const refresh = () => void loadBacklinks();
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, [isOpen, loadBacklinks]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        panelRef.current?.focus();
        const detachTrap = attachFocusTrap(panelRef.current);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            detachTrap();
        };
    }, [isOpen, onClose]);

    const matchCount = results.reduce((count, result) => count + result.matches.length, 0);

    // On the phone the backlinks panel is a full-screen sheet: once a result
    // is opened it must step aside so the user actually sees the note.
    const handleResultClick = (path: string, line: number) => {
        onFileSelect(path, line);
        if (IS_MOBILE) onClose();
    };

    return (
        <aside
            ref={panelRef}
            role="navigation"
            aria-label="Backlinks"
            tabIndex={-1}
            data-panel="left"
            className={`fixed left-0 top-12 bottom-7 w-72 bg-[var(--bg-secondary)] border-r border-[var(--border)] z-50 shadow-2xl flex flex-col overflow-hidden transition-transform duration-200 ease-out ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
            <div className="h-10 shrink-0 px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select">
                    <span className="material-symbols-outlined text-[18px]">link</span>
                    <span>Backlinks</span>
                    {!isLoading && !error && (
                        <span className="text-[10px] text-[var(--text-muted)]">{matchCount}</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => void loadBacklinks()}
                        aria-label="Refresh backlinks"
                        className="btn-press flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                    </button>
                    <button
                        onClick={onClose}
                        aria-label="Close backlinks"
                        className="btn-press flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {isLoading ? (
                    <div className="py-8 text-center text-sm text-[var(--text-secondary)]">Loading…</div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center text-sm" role="alert">
                        <img src={mascotMagnify} alt="" aria-hidden="true" draggable={false} className="w-20 h-20 object-contain select-none opacity-90" />
                        <span className="text-[var(--danger)]">{error}</span>
                    </div>
                ) : results.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center text-sm text-[var(--text-secondary)]">
                        <img src={mascotReading} alt="" aria-hidden="true" draggable={false} className="w-20 h-20 object-contain select-none opacity-90" />
                        <span>No notes link here yet.</span>
                    </div>
                ) : (
                    <ul className="py-2" aria-label="Notes linking to this file">
                        {results.map((result) => (
                            <li key={result.path} className="border-b border-[var(--border-subtle)] last:border-b-0">
                                <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                                    <span className="material-symbols-outlined text-[14px]">description</span>
                                    <span className="truncate">{result.name}</span>
                                </div>
                                <ul className="pb-2">
                                    {result.matches.map((match) => (
                                        <li key={`${result.path}:${match.line}`}>
                                            <button
                                                onClick={() => handleResultClick(result.path, match.line)}
                                                className="btn-press w-full px-4 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                                                aria-label={`Open ${result.name} at line ${match.line}`}
                                            >
                                                <span className="mr-2 text-[10px] text-[var(--text-muted)]">{match.line}</span>
                                                <span className="line-clamp-2">{match.text}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </aside>
    );
}
