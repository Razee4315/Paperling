import { useEffect, useMemo, useRef } from "react";
import { computeStats } from "../utils/documentStats";
import { attachFocusTrap } from "../utils/focusTrap";
import iconClock from "../assets/mascot/icon-clock.png";
import { useI18n } from "../i18n";

interface StatsDialogProps {
    isOpen: boolean;
    content: string;
    onClose: () => void;
}

const formatReadingTime = (min: number, t: ReturnType<typeof useI18n>["t"]): string => {
    if (min < 1) return t("stats.readingTimeLessThanMin");
    if (min < 60) return t("stats.readingTimeMin", { min: Math.round(min) });
    const hours = Math.floor(min / 60);
    const rem = Math.round(min % 60);
    return rem === 0 ? t("stats.readingTimeHours", { hours }) : t("stats.readingTimeHoursMin", { hours, min: rem });
};

export function StatsDialog({ isOpen, content, onClose }: StatsDialogProps) {
    const { t } = useI18n();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    const stats = useMemo(() => (isOpen ? computeStats(content) : null), [isOpen, content]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey);
        const detach = attachFocusTrap(dialogRef.current);
        closeButtonRef.current?.focus();
        return () => {
            document.removeEventListener("keydown", onKey);
            detach();
        };
    }, [isOpen, onClose]);

    if (!isOpen || !stats) return null;

    const rows: Array<[string, string]> = [
        [t("stats.words"), stats.words.toLocaleString()],
        [t("stats.characters"), stats.chars.toLocaleString()],
        [t("stats.charactersNoSpaces"), stats.charsNoSpaces.toLocaleString()],
        [t("stats.sentences"), stats.sentences.toLocaleString()],
        [t("stats.paragraphs"), stats.paragraphs.toLocaleString()],
        [t("stats.lines"), stats.lines.toLocaleString()],
        [t("stats.headings"), stats.headings.toLocaleString()],
        [t("stats.links"), stats.links.toLocaleString()],
        [t("stats.images"), stats.images.toLocaleString()],
        [t("stats.codeBlocks"), stats.codeBlocks.toLocaleString()],
        [t("stats.readingTime"), formatReadingTime(stats.readingTimeMin, t)],
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t("stats.title")}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div
                ref={dialogRef}
                className="relative z-10 w-[420px] max-w-[92vw] bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
            >
                <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
                    <div className="flex items-center gap-3">
                        <img src={iconClock} alt="" aria-hidden="true" draggable={false} className="w-8 h-8 object-contain select-none" />
                        <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("stats.title")}</h2>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label={t("stats.close")}
                        className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </header>
                <dl className="px-5 py-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {rows.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-[var(--text-secondary)]">{label}</dt>
                            <dd className="text-right font-mono text-[var(--text-primary)] tabular-nums">{value}</dd>
                        </div>
                    ))}
                </dl>
                <footer className="px-5 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                    {t("stats.footnote")}
                </footer>
            </div>
        </div>
    );
}
