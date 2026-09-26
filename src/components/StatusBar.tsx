import { memo } from "react";

interface StatusBarProps {
    isSaved: boolean;
    lineNumber: number;
    columnNumber: number;
    mode?: "preview" | "code" | "split";
    showFileExplorer?: boolean;
    showTOC?: boolean;
    showBacklinks?: boolean;
    onToggleFileExplorer?: () => void;
    onToggleTOC?: () => void;
    onToggleBacklinks?: () => void;
    wordCount?: number;
    charCount?: number;
    readingTimeMin?: number;
    /** Character count of the active selection (0 = no selection). */
    selectionLength?: number;
    /** Word count inside the active selection. Only meaningful when
     *  `selectionLength > 0`. */
    selectionWordCount?: number;
    /** Bumped on each manual Ctrl+S; replays the "Saved" pulse. SAVE-07. */
    savePulse?: number;
}

const formatReadingTime = (min: number): string => {
    if (min < 1) return "< 1 min read";
    if (min < 60) return `${Math.round(min)} min read`;
    const hours = Math.floor(min / 60);
    const rem = Math.round(min % 60);
    return rem === 0 ? `${hours}h read` : `${hours}h ${rem}m read`;
};

function StatusBarImpl({
    isSaved,
    lineNumber,
    columnNumber,
    mode = "preview",
    showFileExplorer = false,
    showTOC = false,
    showBacklinks = false,
    onToggleFileExplorer,
    onToggleTOC,
    onToggleBacklinks,
    wordCount,
    charCount,
    readingTimeMin,
    selectionLength = 0,
    selectionWordCount = 0,
    savePulse = 0,
}: StatusBarProps) {
    const hasSelection = selectionLength > 0;
    return (
        // Not a live region: role="status" made screen readers announce the
        // whole bar (Ln/Col, word count) on every keystroke. Only the save
        // state is announced, from its own polite region below. A11Y-05.
        <footer
            aria-label="Status bar"
            className="h-7 shrink-0 bg-[var(--bg-titlebar)] border-t border-[var(--border)] px-4 flex items-center justify-between text-[11px] font-medium tracking-wide tabular-nums text-[var(--text-secondary)] no-select transition-colors"
        >
            <div className="flex items-center gap-1">
                {/* File Explorer Toggle */}
                <button
                    data-tour="file-explorer"
                    onClick={onToggleFileExplorer}
                    title="Files (Ctrl+Shift+E)"
                    aria-label={showFileExplorer ? "Close file explorer" : "Open file explorer"}
                    aria-pressed={showFileExplorer}
                    className={`btn-press flex items-center justify-center w-8 h-6 rounded transition-colors ${showFileExplorer
                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                        : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    <span className="material-symbols-outlined text-[14px]">
                        folder_open
                    </span>
                </button>

                {/* TOC Toggle */}
                <button
                    data-tour="toc"
                    onClick={onToggleTOC}
                    title="Table of Contents (Ctrl+Shift+O)"
                    aria-label={showTOC ? "Close table of contents" : "Open table of contents"}
                    aria-pressed={showTOC}
                    className={`btn-press flex items-center justify-center w-8 h-6 rounded transition-colors ${showTOC
                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                        : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    <span className="material-symbols-outlined text-[14px]">
                        format_list_bulleted
                    </span>
                </button>

                {/* Backlinks Toggle */}
                <button
                    onClick={onToggleBacklinks}
                    title="Backlinks"
                    aria-label={showBacklinks ? "Close backlinks" : "Open backlinks"}
                    aria-pressed={showBacklinks}
                    className={`btn-press flex items-center justify-center w-8 h-6 rounded transition-colors ${showBacklinks
                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                        : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    <span className="material-symbols-outlined text-[14px]">link</span>
                </button>
            </div>
            <div className="flex items-center gap-4">
                <div
                    // key: a new pulse remounts the element so the animation replays.
                    key={savePulse}
                    className={`flex items-center gap-1.5 ${savePulse > 0 ? "save-pulse" : ""}`}
                    aria-label={isSaved ? "File saved" : "File has unsaved changes"}
                >
                    <span
                        className={`w-2 h-2 rounded-full transition-all ${isSaved
                            ? "bg-[var(--status-saved)] shadow-[0_0_4px_rgba(80,250,123,0.4)]"
                            : "bg-[var(--status-unsaved)] shadow-[0_0_4px_rgba(255,184,108,0.4)] status-dot-unsaved"
                            }`}
                    ></span>
                    <span className="transition-colors" role="status" aria-live="polite">{isSaved ? "Saved" : "Unsaved"}</span>
                </div>
                {(mode === "code" || mode === "split") && (
                    // Tabular digits (footer) plus a minimum width: Ln/Col and
                    // the counts no longer nudge their neighbours sideways as
                    // they grow while typing. RLL-05.
                    <div className="min-w-[6.5rem] text-right hover:text-[var(--text-primary)] cursor-default transition-colors">
                        Ln {lineNumber}, Col {columnNumber}
                    </div>
                )}
                {wordCount !== undefined && (
                    <div
                        className={`flex items-center gap-1 cursor-default transition-colors ${hasSelection ? "text-[var(--accent)]" : "hover:text-[var(--text-primary)]"}`}
                        // The visible text is a WORD count, so the accessible
                        // name must say words too — the character detail stays
                        // as a hover title only (it used to leak into the
                        // accessibility tree as the node's name, so screen
                        // readers read "42 characters" for "42 words").
                        aria-label={
                            hasSelection
                                ? `Selected ${selectionWordCount.toLocaleString()} of ${wordCount.toLocaleString()} words`
                                : `${wordCount.toLocaleString()} words`
                        }
                        title={
                            hasSelection
                                ? `Selection: ${selectionWordCount.toLocaleString()} words, ${selectionLength.toLocaleString()} characters`
                                : (charCount !== undefined ? `${charCount.toLocaleString()} characters` : undefined)
                        }
                    >
                        <span className="material-symbols-outlined text-[14px] opacity-70">text_fields</span>
                        {hasSelection
                            ? `${selectionWordCount.toLocaleString()} / ${wordCount.toLocaleString()} ${wordCount === 1 ? "word" : "words"}`
                            : `${wordCount.toLocaleString()} ${wordCount === 1 ? "word" : "words"}`}
                    </div>
                )}
                {readingTimeMin !== undefined && readingTimeMin > 0 && (
                    <div
                        className="flex items-center gap-1 hover:text-[var(--text-primary)] cursor-default transition-colors"
                        title="Estimated reading time at 200 wpm"
                    >
                        <span className="material-symbols-outlined text-[14px] opacity-70">schedule</span>
                        {formatReadingTime(readingTimeMin)}
                    </div>
                )}
            </div>
        </footer>
    );
}

// React.memo so the status bar bails out when its props haven't actually
// changed. During typing, App re-renders on every keystroke (live `content`
// state), but most StatusBar inputs (wordCount/charCount/readingTime are
// debounced; selection counts collapse to 0 while typing) don't. Without
// memo, every keystroke reconciled the whole footer; with it, the typing
// path skips the status bar's render entirely between caret moves.
export const StatusBar = memo(StatusBarImpl);
