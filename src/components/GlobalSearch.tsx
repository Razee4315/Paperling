import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { attachFocusTrap } from "../utils/focusTrap";

interface SearchMatch {
    line: number;
    text: string;
}
interface FileResult {
    path: string;
    name: string;
    matches: SearchMatch[];
}

interface GlobalSearchProps {
    isOpen: boolean;
    /** Folder to search (the current file's directory), or null when no file is open. */
    directory: string | null;
    onClose: () => void;
    onOpenResult: (path: string, line: number) => void;
}

/** Flattened, keyboard-navigable view of one match. */
interface FlatItem {
    path: string;
    line: number;
}

export function GlobalSearch({ isOpen, directory, onClose, onOpenResult }: GlobalSearchProps) {
    const [query, setQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [results, setResults] = useState<FileResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [active, setActive] = useState(0);

    const panelRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const reqIdRef = useRef(0);

    // Flat list of every match, in render order, for arrow-key navigation.
    const flat = useMemo<FlatItem[]>(
        () => results.flatMap((r) => r.matches.map((m) => ({ path: r.path, line: m.line }))),
        [results]
    );
    const totalMatches = flat.length;

    // Reset transient state each time the panel opens; focus the input.
    useEffect(() => {
        if (!isOpen) return;
        setActive(0);
        const t = window.setTimeout(() => inputRef.current?.focus(), 0);
        const detachTrap = attachFocusTrap(panelRef.current);
        return () => { window.clearTimeout(t); detachTrap(); };
    }, [isOpen]);

    // Keep the keyboard-active match in view (same pattern as the command
    // palette). Without this, arrow-key navigation silently disappeared below
    // the fold of the results list. GS-02.
    useEffect(() => {
        if (active < 0) return;
        panelRef.current
            ?.querySelector<HTMLElement>(`[data-match-idx="${active}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [active, results]);

    // Debounced search. A monotonic request id guards against out-of-order
    // responses (a slow early query resolving after a faster later one).
    useEffect(() => {
        if (!isOpen) return;
        const q = query.trim();
        if (!q || !directory) {
            setResults([]);
            setLoading(false);
            setError(null);
            return;
        }
        const id = ++reqIdRef.current;
        setLoading(true);
        const handle = window.setTimeout(() => {
            invoke<FileResult[]>("search_files", { directory, query: q, caseSensitive })
                .then((res) => {
                    if (reqIdRef.current !== id) return;
                    setResults(res);
                    setError(null);
                    setActive(0);
                })
                .catch((err) => {
                    if (reqIdRef.current !== id) return;
                    setResults([]);
                    setError(typeof err === "string" ? err : "Search failed");
                })
                .finally(() => {
                    if (reqIdRef.current === id) setLoading(false);
                });
        }, 200);
        return () => window.clearTimeout(handle);
    }, [isOpen, query, caseSensitive, directory]);

    const openItem = (item: FlatItem | undefined) => {
        if (!item) return;
        // Stay OPEN: closing (which unmounts the component and reset the
        // query) meant every match iteration required reopening the panel and
        // retyping the query. Obsidian/VS Code keep results docked while you
        // hop through them. GS-01.
        onOpenResult(item.path, item.line);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(0, totalMatches - 1))); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
        else if (e.key === "Enter") { e.preventDefault(); openItem(flat[active]); }
    };

    if (!isOpen) return null;

    // Running index so each match knows its position in the flat list.
    let flatIndex = -1;

    return (
        <div
            className="fixed inset-0 z-[80] flex items-start justify-center pt-[10vh] bg-black/40 animate-fade-in"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-label="Search in files"
                onKeyDown={handleKeyDown}
                className="w-[min(680px,92vw)] max-h-[70vh] flex flex-col bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
            >
                {/* Search input row */}
                <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--border)]">
                    <span className="material-symbols-outlined text-[20px] text-[var(--text-muted)]">search</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={directory ? "Search across files in this folder…" : "Open a file first to search its folder"}
                        disabled={!directory}
                        className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                    />
                    <button
                        onClick={() => setCaseSensitive((v) => !v)}
                        aria-pressed={caseSensitive}
                        title="Match case"
                        className={`flex items-center justify-center w-7 h-7 rounded-md text-xs font-semibold transition-colors ${caseSensitive ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                    >
                        Aa
                    </button>
                    <button onClick={onClose} aria-label="Close search" className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                {/* Results */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {error ? (
                        <div className="p-6 text-sm text-[var(--danger)]" role="alert">{error}</div>
                    ) : !query.trim() ? (
                        <div className="p-6 text-sm text-[var(--text-muted)]">Type to search every markdown file in the current folder.</div>
                    ) : loading && results.length === 0 ? (
                        <div className="p-6 text-sm text-[var(--text-secondary)]">Searching…</div>
                    ) : totalMatches === 0 ? (
                        <div className="p-6 text-sm text-[var(--text-secondary)]">No matches.</div>
                    ) : (
                        <div className="py-2">
                            <div className="px-4 pb-2 text-xs text-[var(--text-muted)]">
                                {totalMatches} match{totalMatches === 1 ? "" : "es"} in {results.length} file{results.length === 1 ? "" : "s"}
                            </div>
                            {results.map((file) => (
                                <div key={file.path} className="mb-1">
                                    <div className="px-4 py-1 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                                        <span className="material-symbols-outlined text-[14px]">description</span>
                                        <span className="truncate">{file.name}</span>
                                    </div>
                                    <ul>
                                        {file.matches.map((m) => {
                                            flatIndex += 1;
                                            const isActive = flatIndex === active;
                                            return (
                                                <li key={`${file.path}:${m.line}`}>
                                                    <button
                                                        data-match-idx={flatIndex}
                                                        onClick={() => openItem({ path: file.path, line: m.line })}
                                                        className={`w-full text-left pl-10 pr-4 py-1 flex items-baseline gap-3 text-sm transition-colors ${isActive ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                                                    >
                                                        <span className={`shrink-0 tabular-nums text-xs ${isActive ? "" : "text-[var(--text-muted)]"}`}>{m.line}</span>
                                                        <span className="truncate font-mono text-[13px]">{m.text}</span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
