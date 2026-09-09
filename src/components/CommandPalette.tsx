import { useEffect, useMemo, useRef, useState } from "react";
import { attachFocusTrap } from "../utils/focusTrap";
import { IS_TOUCH } from "../utils/platform";

export interface PaletteCommand {
    id: string;
    label: string;
    /** Optional secondary description shown on the right (path, shortcut, etc). */
    hint?: string;
    /** Section label — items are grouped by this. */
    section: string;
    /** Material symbol icon name. */
    icon?: string;
    /** Extra search keywords (not visible). */
    keywords?: string;
    run: () => void;
}

interface CommandPaletteProps {
    isOpen: boolean;
    items: PaletteCommand[];
    onClose: () => void;
}

/** Indices in `haystack` that `needle` matches, mirroring fuzzyScore's logic
 *  (substring first, then subsequence). Returns null when there's no match, so
 *  callers can fall back to the plain label. */
function matchIndices(needle: string, haystack: string): number[] | null {
    if (!needle) return null;
    const n = needle.toLowerCase();
    const h = haystack.toLowerCase();
    const sub = h.indexOf(n);
    if (sub !== -1) {
        return Array.from({ length: n.length }, (_, i) => sub + i);
    }
    const out: number[] = [];
    let hi = 0;
    for (let ni = 0; ni < n.length; ni++) {
        const found = h.indexOf(n[ni], hi);
        if (found === -1) return null;
        out.push(found);
        hi = found + 1;
    }
    return out;
}

/** Render `label` with the characters matched by `query` accented, so it's
 *  obvious why a result ranked where it did. Coalesces adjacent matched/plain
 *  characters into runs to keep the node count down. */
function highlightLabel(label: string, query: string): React.ReactNode {
    const q = query.trim();
    if (!q) return label;
    const idx = matchIndices(q, label);
    if (!idx) return label;
    const matched = new Set(idx);
    const parts: React.ReactNode[] = [];
    let buf = "";
    let bufMatched = matched.has(0);
    const flush = (key: number) => {
        if (!buf) return;
        parts.push(
            bufMatched
                ? <mark key={key} className="bg-transparent text-[var(--accent)] font-semibold">{buf}</mark>
                : <span key={key}>{buf}</span>
        );
        buf = "";
    };
    for (let i = 0; i < label.length; i++) {
        const m = matched.has(i);
        if (i > 0 && m !== bufMatched) {
            flush(i);
            bufMatched = m;
        }
        buf += label[i];
    }
    flush(label.length);
    return parts;
}

/** Tiny fzf-style ranker. Returns -1 for no match, otherwise a score (lower = better). */
function fuzzyScore(needle: string, haystack: string): number {
    if (!needle) return 0;
    const n = needle.toLowerCase();
    const h = haystack.toLowerCase();
    if (h.includes(n)) return h.indexOf(n); // substring match — best
    let hi = 0;
    let score = 0;
    let lastIdx = -1;
    for (let ni = 0; ni < n.length; ni++) {
        const ch = n[ni];
        const found = h.indexOf(ch, hi);
        if (found === -1) return -1;
        if (lastIdx !== -1) score += (found - lastIdx);
        lastIdx = found;
        hi = found + 1;
    }
    return 1000 + score; // worse than substring matches
}

/** Keyboard-shortcut hints (Ctrl+P, Alt+J, F11…) are desktop affordances;
 *  touch devices hide them rather than advertise chords nobody can press. */
function isShortcutHint(hint: string): boolean {
    return /^(Ctrl|Alt|Shift|⌘|Meta)\+|^(Ctrl|Alt|Shift|⌘|Meta)$|^F\d{1,2}$/.test(hint.trim());
}

export function CommandPalette({ isOpen, items, onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const dialogRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Reset state on open
    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setActiveIdx(0);
        }
    }, [isOpen]);

    // Focus input + trap, Escape to close
    useEffect(() => {
        if (!isOpen) return;
        // Trap first (captures the trigger for focus-restore on close), then
        // move focus into the search input. UX-01.
        const detach = attachFocusTrap(dialogRef.current);
        const input = dialogRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            detach();
            document.removeEventListener("keydown", onKey);
        };
    }, [isOpen, onClose]);

    // Filtered + sorted result
    const ranked = useMemo(() => {
        if (!isOpen) return [];
        if (!query.trim()) return items;
        const scored = items
            .map((it) => {
                const candidates = [it.label, it.hint ?? "", it.keywords ?? "", it.section];
                let best = -1;
                for (const c of candidates) {
                    const s = fuzzyScore(query, c);
                    if (s !== -1 && (best === -1 || s < best)) best = s;
                }
                return { item: it, score: best };
            })
            .filter((r) => r.score !== -1)
            .sort((a, b) => a.score - b.score)
            .map((r) => r.item);
        return scored;
    }, [items, query, isOpen]);

    // Group by section preserving order
    const grouped = useMemo(() => {
        const out: Array<{ section: string; items: PaletteCommand[] }> = [];
        const seen = new Map<string, number>();
        for (const it of ranked) {
            const idx = seen.get(it.section);
            if (idx === undefined) {
                seen.set(it.section, out.length);
                out.push({ section: it.section, items: [it] });
            } else {
                out[idx].items.push(it);
            }
        }
        return out;
    }, [ranked]);

    // Keep activeIdx valid when results change. Functional update so React
    // bails out via Object.is when no clamp is needed — otherwise this effect
    // would queue a setState on every render where activeIdx is already in
    // range, triggering the same setState-in-effect pattern that caused the
    // earlier "Maximum update depth" crash.
    useEffect(() => {
        setActiveIdx((prev) => (prev >= ranked.length ? 0 : prev));
    }, [ranked.length]);

    // Auto-scroll active row into view
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const active = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
        active?.scrollIntoView({ block: "nearest" });
    }, [activeIdx]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => (ranked.length === 0 ? 0 : (i + 1) % ranked.length));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => (ranked.length === 0 ? 0 : (i - 1 + ranked.length) % ranked.length));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const cmd = ranked[activeIdx];
            if (cmd) {
                onClose();
                cmd.run();
            }
        }
    };

    if (!isOpen) return null;

    let runningIdx = -1;

    return (
        <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

            <div
                ref={dialogRef}
                className="relative z-10 w-[640px] max-w-[92vw] flex flex-col bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
                onKeyDown={onKeyDown}
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
                    <span className="material-symbols-outlined text-[var(--text-secondary)]">search</span>
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Type a command, file, or heading…"
                        aria-label="Search commands"
                        className="flex-1 bg-transparent text-[var(--text-primary)] outline-none text-sm placeholder:text-[var(--text-muted)]"
                    />
                    {!IS_TOUCH && (
                        <kbd className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-muted)]">Esc</kbd>
                    )}
                </div>

                <ul ref={listRef} className="max-h-[420px] overflow-y-auto py-1" role="listbox">
                    {ranked.length === 0 ? (
                        <li className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">No results</li>
                    ) : grouped.map((g) => (
                        <li key={g.section}>
                            <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                {g.section}
                            </div>
                            <ul>
                                {g.items.map((cmd) => {
                                    runningIdx++;
                                    const idx = runningIdx;
                                    const active = idx === activeIdx;
                                    return (
                                        <li key={cmd.id}>
                                            <button
                                                role="option"
                                                aria-selected={active}
                                                data-idx={idx}
                                                onMouseEnter={() => setActiveIdx(idx)}
                                                onClick={() => { onClose(); cmd.run(); }}
                                                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${active ? "bg-[var(--bg-hover)]" : ""}`}
                                            >
                                                <span className={`material-symbols-outlined text-[18px] shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                                                    {cmd.icon ?? "chevron_right"}
                                                </span>
                                                <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{highlightLabel(cmd.label, query)}</span>
                                                {cmd.hint && !(IS_TOUCH && isShortcutHint(cmd.hint)) && (
                                                    <span className="text-[11px] text-[var(--text-muted)] tabular-nums truncate ml-2 shrink-0">
                                                        {cmd.hint}
                                                    </span>
                                                )}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    ))}
                </ul>

                <div className="px-4 py-1.5 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] bg-[var(--bg-titlebar)] flex items-center gap-3">
                    {/* ↑↓/↵ hint chips are keyboard affordances; touch users
                        navigate by tapping, so only the count stays. */}
                    {!IS_TOUCH && (
                        <span className="flex items-center gap-3">
                            <span><kbd className="px-1 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">↑↓</kbd> navigate</span>
                            <span><kbd className="px-1 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">↵</kbd> run</span>
                        </span>
                    )}
                    <span className="ml-auto">{ranked.length} {ranked.length === 1 ? "result" : "results"}</span>
                </div>
            </div>
        </div>
    );
}
