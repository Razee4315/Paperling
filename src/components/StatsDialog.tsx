import { useEffect, useMemo, useRef } from "react";
import { computeStats } from "../utils/documentStats";
import { attachFocusTrap } from "../utils/focusTrap";
import iconClock from "../assets/mascot/icon-clock.png";

interface StatsDialogProps {
    isOpen: boolean;
    content: string;
    onClose: () => void;
}

const formatReadingTime = (min: number): string => {
    if (min < 1) return "< 1 min";
    if (min < 60) return `${Math.round(min)} min`;
    const hours = Math.floor(min / 60);
    const rem = Math.round(min % 60);
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
};

export function StatsDialog({ isOpen, content, onClose }: StatsDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

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
        return () => {
            document.removeEventListener("keydown", onKey);
            detach();
        };
    }, [isOpen, onClose]);

    if (!isOpen || !stats) return null;

    const rows: Array<[string, string]> = [
        ["Words", stats.words.toLocaleString()],
        ["Characters", stats.chars.toLocaleString()],
        ["Characters (no spaces)", stats.charsNoSpaces.toLocaleString()],
        ["Sentences", stats.sentences.toLocaleString()],
        ["Paragraphs", stats.paragraphs.toLocaleString()],
        ["Lines", stats.lines.toLocaleString()],
        ["Headings", stats.headings.toLocaleString()],
        ["Links", stats.links.toLocaleString()],
        ["Images", stats.images.toLocaleString()],
        ["Code blocks", stats.codeBlocks.toLocaleString()],
        ["Reading time", formatReadingTime(stats.readingTimeMin)],
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Document statistics">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div
                ref={dialogRef}
                className="relative z-10 w-[420px] max-w-[92vw] bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
            >
                <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
                    <div className="flex items-center gap-3">
                        <img src={iconClock} alt="" aria-hidden="true" draggable={false} className="w-8 h-8 object-contain select-none" />
                        <h2 className="text-base font-semibold text-[var(--text-primary)]">Document statistics</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close statistics"
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
                    Reading time assumes ~200 words per minute. Word and sentence counts exclude code blocks, frontmatter, and Markdown syntax.
                </footer>
            </div>
        </div>
    );
}
