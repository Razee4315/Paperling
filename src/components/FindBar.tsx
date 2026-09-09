import { useCallback, useEffect, useRef, useState } from "react";
import { IS_MOBILE } from "../utils/platform";

/**
 * The one find-in-document mechanism (FIND-01). A single bar UI + behaviour
 * (debounce, clear-on-change, N-of-M, next/prev, Esc/Enter) drives a
 * `FindController` — the only surface-specific part. Cmd-F searches two genuinely
 * different surfaces, so there are two thin adapters behind this one component:
 *
 *   • the CodeMirror source text (code/split mode) — see CodeEditor's controller,
 *     which supports replace + regex and highlights matches with editor
 *     decorations;
 *   • the rendered markdown DOM (reader mode) — see createPreviewFindController,
 *     which is find-only and highlights with the CSS Custom Highlight API.
 *
 * Everything the user sees and feels is this component; the adapters only find,
 * highlight and (for the editor) replace.
 */

export interface FindOpts {
    caseSensitive: boolean;
    regex: boolean;
}

export interface FindResult {
    /** Number of matches found. */
    count: number;
    /** Which match to emphasise first (e.g. the one at/after the caret), or -1. */
    activeIndex: number;
}

export interface FindController {
    /** Source-text surfaces show the replace row; rendered-HTML surfaces don't. */
    supportsReplace: boolean;
    /** Regex only makes sense over source text, so the toggle is surface-gated. */
    supportsRegex: boolean;
    /** Half-typed regex reads as "Invalid pattern" rather than "No results". */
    isValidPattern(query: string, opts: FindOpts): boolean;
    /** Recompute + paint every match; returns the count and where to start. */
    search(query: string, opts: FindOpts): FindResult;
    /** Emphasise + reveal match #index (0-based); no-op if out of range. */
    setActive(index: number): void;
    /** Remove every highlight this controller painted. */
    clear(): void;
    /** Replace match #index. Present only when supportsReplace. */
    replaceActive?(index: number, replacement: string, query: string, opts: FindOpts): void;
    /** Replace every match. Present only when supportsReplace. */
    replaceAll?(replacement: string, query: string, opts: FindOpts): void;
}

interface FindBarProps {
    isOpen: boolean;
    initialMode?: "find" | "replace";
    controller: FindController;
    /** Changes whenever the searchable content changes; re-runs the search. */
    revision: unknown;
    onClose: () => void;
}

const DEBOUNCE_MS = 400;

export function FindBar({ isOpen, initialMode = "find", controller, revision, onClose }: FindBarProps) {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [showReplace, setShowReplace] = useState(initialMode === "replace" && controller.supportsReplace);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [regex, setRegex] = useState(false);
    const [activeIdx, setActiveIdx] = useState(-1);
    const [count, setCount] = useState(0);
    const [invalid, setInvalid] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const useRegex = regex && controller.supportsRegex;

    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            inputRef.current?.select();
            setShowReplace(initialMode === "replace" && controller.supportsReplace);
        }
    }, [isOpen, initialMode, controller]);

    // Clear the previous highlights the instant the query (or its options)
    // changes, so nothing stale lingers on screen during the debounce window —
    // only matches for the settled query are ever painted. Navigation (next/prev)
    // doesn't touch these deps, so moving the active match never blanks the rest.
    useEffect(() => {
        controller.clear();
    }, [query, caseSensitive, regex, controller]);

    // Recompute matches (debounced) when the query, its options, or the content
    // changes. Editor keystrokes bump `revision`, so matches track live edits.
    useEffect(() => {
        if (!isOpen) return;
        const q = query;
        const opts: FindOpts = { caseSensitive, regex: useRegex };
        if (!q) {
            controller.clear();
            setCount(0);
            setActiveIdx(-1);
            setInvalid(false);
            return;
        }
        if (!controller.isValidPattern(q, opts)) {
            controller.clear();
            setCount(0);
            setActiveIdx(-1);
            setInvalid(true);
            return;
        }
        const id = window.setTimeout(() => {
            const { count: n, activeIndex } = controller.search(q, opts);
            setInvalid(false);
            setCount(n);
            setActiveIdx(n > 0 ? activeIndex : -1);
            if (n === 0) controller.clear();
        }, DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [isOpen, query, caseSensitive, regex, useRegex, revision, controller]);

    // Emphasise + reveal the active match whenever it (or the result set) changes.
    // The all-matches paint happens in search(); this only moves the emphasis.
    useEffect(() => {
        if (activeIdx >= 0 && activeIdx < count) controller.setActive(activeIdx);
    }, [activeIdx, count, controller]);

    // Drop every highlight when the bar closes or unmounts.
    useEffect(() => {
        if (!isOpen) controller.clear();
    }, [isOpen, controller]);
    useEffect(() => () => controller.clear(), [controller]);

    const next = useCallback(() => {
        setActiveIdx((i) => (count === 0 ? -1 : (i + 1) % count));
    }, [count]);
    const prev = useCallback(() => {
        setActiveIdx((i) => (count === 0 ? -1 : (i - 1 + count) % count));
    }, [count]);

    const replaceCurrent = useCallback(() => {
        if (activeIdx < 0 || !controller.replaceActive) return;
        controller.replaceActive(activeIdx, replacement, query, { caseSensitive, regex: useRegex });
    }, [activeIdx, controller, replacement, query, caseSensitive, useRegex]);
    const replaceAll = useCallback(() => {
        if (count === 0 || !controller.replaceAll) return;
        controller.replaceAll(replacement, query, { caseSensitive, regex: useRegex });
    }, [count, controller, replacement, query, caseSensitive, useRegex]);

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) prev();
            else next();
        }
    };

    if (!isOpen) return null;

    const totalLabel = invalid
        ? "Invalid pattern"
        : count === 0
            ? (query.trim() ? "No results" : "")
            : `${activeIdx + 1} of ${count}`;

    // Two desktop/mobile shapes from one component. The desktop single row
    // (input + count + prev/next + toggles + close) needs ~420px; on a phone
    // the row used to overflow the viewport and pushed the close button (and
    // the whole Replace row) off-screen — the bar became impossible to close.
    // Mobile therefore wraps the controls onto their own second row and every
    // input gets min-w-0 so flex can actually shrink it.
    const navButtons = (
        <>
            <button onClick={prev} title="Previous (Shift+Enter)" aria-label="Previous match" className="w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
                <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
            </button>
            <button onClick={next} title="Next (Enter)" aria-label="Next match" className="w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
                <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
            </button>
            <button
                onClick={() => setCaseSensitive((v) => !v)}
                aria-pressed={caseSensitive}
                title="Match case"
                className={`w-6 h-6 rounded text-[12px] font-bold flex items-center justify-center ${caseSensitive ? "bg-[var(--accent)] text-[var(--accent-text)]" : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"}`}
            >
                Aa
            </button>
            {controller.supportsRegex && (
                <button
                    onClick={() => setRegex((v) => !v)}
                    aria-pressed={regex}
                    title="Regex"
                    className={`w-6 h-6 rounded text-[12px] font-mono flex items-center justify-center ${regex ? "bg-[var(--accent)] text-[var(--accent-text)]" : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"}`}
                >
                    .*
                </button>
            )}
        </>
    );

    return (
        <div
            role="dialog"
            aria-label={controller.supportsReplace ? "Find and replace" : "Find in document"}
            className="find-bar absolute top-2 right-4 z-40 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl px-2 py-2 flex flex-col gap-2 animate-fade-in-down"
            style={{ minWidth: controller.supportsReplace ? 360 : 300 }}
            onKeyDown={handleKey}
        >
            <div className="flex items-center gap-2">
                {controller.supportsReplace && (
                    <button
                        type="button"
                        onClick={() => setShowReplace((v) => !v)}
                        aria-label={showReplace ? "Hide replace" : "Show replace"}
                        className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                    >
                        <span className="material-symbols-outlined text-[16px]">
                            {showReplace ? "expand_less" : "expand_more"}
                        </span>
                    </button>
                )}
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find in document"
                    enterKeyHint="search"
                    className="flex-1 min-w-0 px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    aria-label="Find text"
                />
                <span className={`text-[11px] tabular-nums whitespace-nowrap min-w-[80px] text-right ${invalid ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}>
                    {totalLabel}
                </span>
                {/* Keep close beside the input on mobile — navigation/toggles
                    wrap to the row below (see FindNavRow). */}
                {!IS_MOBILE && navButtons}
                <button onClick={onClose} title="Close (Esc)" aria-label="Close find" className="w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>

            {IS_MOBILE && (
                <div className="flex items-center gap-2">
                    {navButtons}
                </div>
            )}

            {controller.supportsReplace && showReplace && (
                <div className={`flex items-center gap-2 ${IS_MOBILE ? "" : "pl-8"}`}>
                    <input
                        type="text"
                        value={replacement}
                        onChange={(e) => setReplacement(e.target.value)}
                        placeholder="Replace"
                        enterKeyHint="done"
                        className="flex-1 min-w-0 px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        aria-label="Replace with"
                    />
                    <button
                        onClick={replaceCurrent}
                        disabled={activeIdx < 0}
                        className="px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                        Replace
                    </button>
                    <button
                        onClick={replaceAll}
                        disabled={count === 0}
                        className="px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                        Replace All
                    </button>
                </div>
            )}
        </div>
    );
}
