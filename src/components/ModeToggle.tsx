import { useI18n } from "../i18n";

export type ViewMode = "preview" | "code" | "split";

interface ModeToggleProps {
    mode: ViewMode;
    onSetMode: (mode: ViewMode) => void;
    /** Shift left when the AI panel is open so the toggle isn't hidden behind it. */
    aiPanelOpen?: boolean;
    /** The panel's current width in px; it is user-resizable (#111). */
    aiPanelWidth?: number;
}

const buttonBase =
    "btn-press flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-200";

export function ModeToggle({ mode, onSetMode, aiPanelOpen, aiPanelWidth = 400 }: ModeToggleProps) {
    const { t } = useI18n();
    return (
        <div
            className="fixed bottom-8 z-50"
            style={{ right: aiPanelOpen ? `calc(min(${aiPanelWidth}px, 90vw) + 2rem)` : "2rem", transition: "right 0.15s ease" }}
            role="group"
            aria-label={t("modeToggle.group")}
        >
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full p-1.5 flex items-center shadow-2xl backdrop-blur-sm transition-colors animate-fade-in">
                <button
                    onClick={() => onSetMode("preview")}
                    aria-label={t("modeToggle.readerAria")}
                    aria-pressed={mode === "preview"}
                    title={t("modeToggle.readerTitle")}
                    className={`${buttonBase} ${mode === "preview"
                        ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-md"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    <span className="material-symbols-outlined text-[20px]">visibility</span>
                    {mode === "preview" && <span className="text-sm font-bold">{t("modeToggle.reader")}</span>}
                </button>

                <button
                    onClick={() => onSetMode("split")}
                    aria-label={t("modeToggle.splitAria")}
                    aria-pressed={mode === "split"}
                    title={t("modeToggle.splitTitle")}
                    className={`${buttonBase} ${mode === "split"
                        ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-md"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    <span className="material-symbols-outlined text-[20px]">vertical_split</span>
                    {mode === "split" && <span className="text-sm font-bold">{t("modeToggle.split")}</span>}
                </button>

                <button
                    onClick={() => onSetMode("code")}
                    aria-label={t("modeToggle.codeAria")}
                    aria-pressed={mode === "code"}
                    title={t("modeToggle.codeTitle")}
                    className={`${buttonBase} ${mode === "code"
                        ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-md"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    {mode === "code" && <span className="text-sm font-bold">{t("modeToggle.code")}</span>}
                    <span className="material-symbols-outlined text-[20px]">code</span>
                </button>
            </div>
        </div>
    );
}
