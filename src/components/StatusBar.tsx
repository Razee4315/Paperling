import { memo } from "react";
import { useI18n } from "../i18n";

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
    /** Makes the "Unsaved" indicator a button that saves. CHROME-02. */
    onSave?: () => void;
    /** The file's encoding when it isn't plain UTF-8. ENC-05. */
    encoding?: string | null;
}

// The wording (and the inflections) live in the dictionary: Chinese does not
// pluralise, so "min read" cannot be assembled from parts here.
const formatReadingTime = (min: number, t: ReturnType<typeof useI18n>["t"]): string =>
    t("statusBar.readingTime", { min });

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
    onSave,
    encoding = null,
}: StatusBarProps) {
    const { t } = useI18n();
    const hasSelection = selectionLength > 0;
    return (
        // Not a live region: role="status" made screen readers announce the
        // whole bar (Ln/Col, word count) on every keystroke. Only the save
        // state is announced, from its own polite region below. A11Y-05.
        <footer
            aria-label={t("statusBar.bar")}
            className="h-7 shrink-0 bg-[var(--bg-titlebar)] border-t border-[var(--border)] px-4 flex items-center justify-between text-[11px] font-medium tracking-wide tabular-nums text-[var(--text-secondary)] no-select transition-colors"
        >
            <div className="flex items-center gap-1">
                {/* File Explorer Toggle */}
                <button
                    onClick={onToggleFileExplorer}
                    title={t("statusBar.filesTitle")}
                    aria-label={showFileExplorer ? t("statusBar.closeExplorer") : t("statusBar.openExplorer")}
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
                    onClick={onToggleTOC}
                    title={t("statusBar.tocTitle")}
                    aria-label={showTOC ? t("statusBar.closeToc") : t("statusBar.openToc")}
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
                    title={t("statusBar.backlinksTitle")}
                    aria-label={showBacklinks ? t("statusBar.closeBacklinks") : t("statusBar.openBacklinks")}
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
                <button
                    type="button"
                    data-tour="save"
                    // key: a new pulse remounts the element so the animation replays.
                    key={savePulse}
                    // "Unsaved" was a label with nothing to click; it is now the
                    // most direct way to save for someone who doesn't use Ctrl+S.
                    onClick={isSaved ? undefined : onSave}
                    disabled={isSaved || !onSave}
                    title={isSaved ? undefined : t("statusBar.clickToSave")}
                    className={`flex items-center gap-1.5 rounded px-1 -mx-1 ${savePulse > 0 ? "save-pulse" : ""} ${isSaved || !onSave ? "cursor-default" : "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
                    aria-label={isSaved ? t("statusBar.fileSaved") : t("statusBar.fileUnsavedSaveNow")}
                >
                    <span
                        className={`w-2 h-2 rounded-full transition-all ${isSaved
                            ? "bg-[var(--status-saved)] shadow-[0_0_4px_rgba(80,250,123,0.4)]"
                            : "bg-[var(--status-unsaved)] shadow-[0_0_4px_rgba(255,184,108,0.4)] status-dot-unsaved"
                            }`}
                    ></span>
                    <span className="transition-colors" role="status" aria-live="polite">{isSaved ? t("statusBar.saved") : t("statusBar.unsaved")}</span>
                </button>
                {(mode === "code" || mode === "split") && (
                    // Tabular digits (footer) plus a minimum width: Ln/Col and
                    // the counts no longer nudge their neighbours sideways as
                    // they grow while typing. RLL-05.
                    <div className="min-w-[6.5rem] text-right hover:text-[var(--text-primary)] cursor-default transition-colors">
                        {t("statusBar.lineCol", { line: lineNumber, column: columnNumber })}
                    </div>
                )}
                {encoding && (
                    <div
                        className="hover:text-[var(--text-primary)] cursor-default transition-colors"
                        title={t("statusBar.encodingTitle")}
                        aria-label={t("statusBar.encodingAria", { encoding })}
                    >
                        {encoding}
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
                                ? t("statusBar.selectedWordsAria", { selected: selectionWordCount, total: wordCount })
                                : t("statusBar.wordsAria", { count: wordCount })
                        }
                        title={
                            hasSelection
                                ? t("statusBar.selectionTitle", { words: selectionWordCount, chars: selectionLength })
                                : (charCount !== undefined ? t("statusBar.charsTitle", { count: charCount }) : undefined)
                        }
                    >
                        <span className="material-symbols-outlined text-[14px] opacity-70">text_fields</span>
                        {hasSelection
                            ? t("statusBar.selectedWords", { selected: selectionWordCount, total: wordCount })
                            : t("statusBar.wordCount", { count: wordCount })}
                    </div>
                )}
                {readingTimeMin !== undefined && readingTimeMin > 0 && (
                    <div
                        className="flex items-center gap-1 hover:text-[var(--text-primary)] cursor-default transition-colors"
                        title={t("statusBar.readingTimeTitle")}
                    >
                        <span className="material-symbols-outlined text-[14px] opacity-70">schedule</span>
                        {formatReadingTime(readingTimeMin, t)}
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
