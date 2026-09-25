import { useEffect, useMemo, useRef, useState } from "react";
import { readTextFile, saveTextFile } from "../utils/fileIO";
import { invoke } from "@tauri-apps/api/core";
import { attachFocusTrap } from "../utils/focusTrap";
import { errMessage } from "../utils/errors";

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
    /** The live buffer of a file that is open in a tab, else null. Replace
     *  edits open files IN THEIR BUFFER: writing the disk behind a tab's back
     *  was silently reverted by that tab's next autosave. GS-04. */
    getOpenBuffer?: (path: string) => string | null;
    /** Write a new buffer for an open file (marks the tab dirty; it saves
     *  through the normal, conflict-guarded save paths). */
    setOpenBuffer?: (path: string, text: string) => boolean;
    /** Pre-fill the query when the panel opens (e.g. a clicked #tag). */
    initialQuery?: string;
    /** Toast access for replace progress/errors. */
    onNotify?: (message: string, type: "success" | "error" | "info") => void;
}

/** Literal (non-regex) matcher honoring the search's case toggle (GS-03).
 *  Counting and replacing share it, so the reported count can't disagree
 *  with what was actually replaced. */
function literalRegex(query: string, caseSensitive: boolean, wholeWord = false): RegExp {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Whole word mirrors the Rust search: not inside a run of letters,
    // digits or underscores (Unicode-aware). GS-05.
    const body = wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc;
    return new RegExp(body, (caseSensitive ? "g" : "gi") + "u");
}

/** Replace every occurrence; returns the new text and how many were replaced. */
export function replaceLiteral(
    content: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    wholeWord = false,
): { text: string; count: number } {
    if (!query) return { text: content, count: 0 };
    let count = 0;
    const text = content.replace(literalRegex(query, caseSensitive, wholeWord), () => {
        count += 1;
        return replacement;
    });
    return { text, count };
}

/** Mirrors SEARCH_MAX_RESULTS in src-tauri/src/commands.rs: at this many
 *  files the result list is truncated, so a replace can't reach every file. */
const SEARCH_MAX_RESULTS = 300;

/** One file rewritten by the last replace, kept so it can be undone. */
interface ReplaceUndoEntry {
    path: string;
    before: string;
    after: string;
    inBuffer: boolean;
}

/** Flattened, keyboard-navigable view of one match. */
interface FlatItem {
    path: string;
    line: number;
}

export function GlobalSearch({ isOpen, directory, onClose, onOpenResult, getOpenBuffer, setOpenBuffer, initialQuery, onNotify }: GlobalSearchProps) {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [confirmPending, setConfirmPending] = useState(false);
    const [replacing, setReplacing] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [results, setResults] = useState<FileResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [active, setActive] = useState(0);
    // The last replace's per-file before/after, for "Undo replace". Cleared
    // when the panel reopens.
    const [undoEntries, setUndoEntries] = useState<ReplaceUndoEntry[] | null>(null);

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
        setConfirmPending(false);
        setReplacing(false);
        setUndoEntries(null);
        if (initialQuery) setQuery(initialQuery);
        const t = window.setTimeout(() => inputRef.current?.focus(), 0);
        const detachTrap = attachFocusTrap(panelRef.current);
        return () => { window.clearTimeout(t); detachTrap(); };
        // Seed only on open; typing afterwards is the user's.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialQuery]);

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
            invoke<FileResult[]>("search_files", { directory, query: q, caseSensitive, wholeWord })
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
    }, [isOpen, query, caseSensitive, wholeWord, directory]);

    const openItem = (item: FlatItem | undefined) => {
        if (!item) return;
        // Stay OPEN: closing (which unmounts the component and reset the
        // query) meant every match iteration required reopening the panel and
        // retyping the query. Obsidian/VS Code keep results docked while you
        // hop through them. GS-01.
        onOpenResult(item.path, item.line);
    };

    const refreshResults = async () => {
        const id = ++reqIdRef.current;
        const res = await invoke<FileResult[]>("search_files", { directory, query: query.trim(), caseSensitive, wholeWord });
        if (reqIdRef.current === id) {
            setResults(res);
            setActive(0);
        }
    };

    // Replace across files (GS-03/04). A file open in a tab is edited in its
    // buffer (it then saves through the normal guarded paths); every other
    // file goes through read_file/save_file so the atomic-write and EOL
    // handling applies. Each file's before/after is kept for "Undo replace".
    const runReplaceAll = async () => {
        setReplacing(true);
        let totalReplaced = 0;
        const undo: ReplaceUndoEntry[] = [];
        const q = query.trim();
        try {
            for (const file of results) {
                if (file.matches.length === 0) continue;
                const buffered = getOpenBuffer?.(file.path) ?? null;
                if (buffered !== null) {
                    const { text, count } = replaceLiteral(buffered, q, replacement, caseSensitive, wholeWord);
                    if (count === 0 || !setOpenBuffer?.(file.path, text)) continue;
                    undo.push({ path: file.path, before: buffered, after: text, inBuffer: true });
                    totalReplaced += count;
                    continue;
                }
                const data = await readTextFile<{ content: string }>(file.path);
                const { text, count } = replaceLiteral(data.content, q, replacement, caseSensitive, wholeWord);
                if (count === 0) continue;
                await saveTextFile(file.path, text);
                undo.push({ path: file.path, before: data.content, after: text, inBuffer: false });
                totalReplaced += count;
            }
            const files = undo.length;
            const openCount = undo.filter((u) => u.inBuffer).length;
            onNotify?.(
                `Replaced ${totalReplaced} match${totalReplaced === 1 ? "" : "es"} in ${files} file${files === 1 ? "" : "s"}` +
                    (openCount > 0 ? ` (${openCount} open in tabs: edited in the editor, unsaved)` : ""),
                "success",
            );
            setUndoEntries(undo.length > 0 ? undo : null);
            await refreshResults();
        } catch (err) {
            // Files rewritten before the failure can still be undone.
            if (undo.length > 0) setUndoEntries(undo);
            onNotify?.(errMessage(err) || "Replace failed", "error");
        } finally {
            setReplacing(false);
            setConfirmPending(false);
        }
    };

    // Undo the last replace. A file is only restored while it still holds
    // exactly what the replace wrote — anything edited since is left alone
    // (and reported) rather than clobbered.
    const runUndoReplace = async () => {
        if (!undoEntries) return;
        setReplacing(true);
        let restored = 0;
        let skipped = 0;
        try {
            for (const entry of undoEntries) {
                if (entry.inBuffer) {
                    if (getOpenBuffer?.(entry.path) === entry.after && setOpenBuffer?.(entry.path, entry.before)) restored += 1;
                    else skipped += 1;
                    continue;
                }
                const data = await readTextFile<{ content: string }>(entry.path);
                if (data.content !== entry.after) {
                    skipped += 1;
                    continue;
                }
                await saveTextFile(entry.path, entry.before);
                restored += 1;
            }
            onNotify?.(
                `Undid the replace in ${restored} file${restored === 1 ? "" : "s"}` +
                    (skipped > 0 ? ` — ${skipped} changed since and ${skipped === 1 ? "was" : "were"} left as is` : ""),
                skipped > 0 ? "info" : "success",
            );
            setUndoEntries(null);
            await refreshResults();
        } catch (err) {
            onNotify?.(errMessage(err) || "Undo failed", "error");
        } finally {
            setReplacing(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(0, totalMatches - 1))); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
        else if (e.key === "Enter") {
            // Enter in the replace field arms / confirms the replace instead of
            // opening a search result.
            if ((e.target as HTMLElement).dataset.replaceInput !== undefined) {
                e.preventDefault();
                if (replacing || replacement === query.trim()) return;
                if (confirmPending) void runReplaceAll();
                else setConfirmPending(true);
                return;
            }
            e.preventDefault();
            openItem(flat[active]);
        }
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
                    <button
                        onClick={() => setWholeWord((v) => !v)}
                        aria-pressed={wholeWord}
                        title="Match whole word"
                        aria-label="Match whole word"
                        className={`flex items-center justify-center w-7 h-7 rounded-md text-xs font-semibold underline underline-offset-2 transition-colors ${wholeWord ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                    >
                        ab
                    </button>
                    <button onClick={onClose} aria-label="Close search" className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                {/* Replace row (GS-03) — offered whenever the folder search has matches. */}
                {results.length > 0 && query.trim() && (
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)]">
                        <input
                            value={replacement}
                            onChange={(e) => { setReplacement(e.target.value); setConfirmPending(false); }}
                            placeholder="Replace with… (leave empty to delete)"
                            aria-label="Replace across files"
                            data-replace-input=""
                            className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                        />
                        {confirmPending ? (
                            <>
                                <span className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                                    {replacement ? "Rewrite" : "Delete matches in"} {results.length} file{results.length === 1 ? "" : "s"}?
                                </span>
                                <button
                                    onClick={runReplaceAll}
                                    disabled={replacing}
                                    className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-[var(--accent-text)] disabled:opacity-40 whitespace-nowrap"
                                >
                                    {replacing ? "Replacing…" : "Confirm"}
                                </button>
                                <button
                                    onClick={() => setConfirmPending(false)}
                                    className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] whitespace-nowrap"
                                >
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setConfirmPending(true)}
                                disabled={replacing || replacement === query.trim()}
                                title={replacement === query.trim() ? "Replacement equals the search" : undefined}
                                className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 whitespace-nowrap"
                            >
                                Replace all in files…
                            </button>
                        )}
                    </div>
                )}

                {results.length >= SEARCH_MAX_RESULTS && (
                    <div className="px-4 py-1.5 text-[11px] text-[var(--text-secondary)] border-b border-[var(--border)] bg-[var(--bg-hover)]" role="note">
                        Showing the first {SEARCH_MAX_RESULTS} files — results are capped, so a replace won't reach every file. Narrow the search to be sure.
                    </div>
                )}
                {undoEntries && (
                    <div className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-[var(--text-secondary)] border-b border-[var(--border)]">
                        <span className="flex-1">Replaced in {undoEntries.length} file{undoEntries.length === 1 ? "" : "s"}.</span>
                        <button
                            onClick={runUndoReplace}
                            disabled={replacing}
                            className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40"
                        >
                            Undo replace
                        </button>
                    </div>
                )}

                {/* Results */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {error ? (
                        <div className="p-6 text-sm text-[var(--danger)]" role="alert">{error}</div>
                    ) : !query.trim() ? (
                        <div className="p-6 text-sm text-[var(--text-muted)]">Type to search every note (.md, .txt) in this folder and its subfolders.</div>
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
