import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { runAIAction, type AIAction, type AIConfig } from "../utils/aiAssist";

interface AIBubbleProps {
    /** Anchor pixel position (top-left of selection or caret). Null hides bubble. */
    anchor: { x: number; y: number } | null;
    /** Currently selected text (or empty for "continue"). */
    selectedText: string;
    config: AIConfig;
    /** Replace the selection with `result`. */
    onReplace: (result: string) => void;
    /** Insert `result` after the selection without replacing. */
    onInsert: (result: string) => void;
    onClose: () => void;
}

const ACTIONS: Array<{ id: AIAction; label: string; icon: string; needsSelection: boolean }> = [
    { id: "rewrite", label: "Rewrite", icon: "auto_fix_high", needsSelection: true },
    { id: "shorten", label: "Shorten", icon: "compress", needsSelection: true },
    { id: "expand", label: "Expand", icon: "expand", needsSelection: true },
    { id: "translate", label: "Translate → EN", icon: "translate", needsSelection: true },
];

export function AIBubble({ anchor, selectedText, config, onReplace, onInsert, onClose }: AIBubbleProps) {
    const [busy, setBusy] = useState<AIAction | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);
    const [adjusted, setAdjusted] = useState<{ left: number; top: number } | null>(null);

    useEffect(() => {
        if (!anchor) {
            setResult(null);
            setError(null);
            setBusy(null);
            abortRef.current?.abort();
        }
    }, [anchor]);

    // Final-cleanup: parents commonly unmount AIBubble outright (e.g. by
    // setting their own `aiBubble` state to null) instead of toggling `anchor`.
    // The effect above only fires while the component is alive, so we also
    // abort here to prevent an in-flight fetch from calling setResult on an
    // unmounted component (React 18+ no-ops the setState but logs a warning,
    // and the request itself keeps running until the network resolves).
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // Reposition the bubble so it stays inside the viewport. Recomputed when
    // the anchor moves or after a result/error appears (which changes height).
    useLayoutEffect(() => {
        if (!anchor || !bubbleRef.current) return;
        const margin = 8;
        const rect = bubbleRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = anchor.x;
        let top = anchor.y;
        if (left + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin);
        if (left < margin) left = margin;
        if (top + rect.height + margin > vh) {
            // Flip above the anchor when there's no room below.
            const flipped = anchor.y - rect.height - 24;
            top = flipped > margin ? flipped : Math.max(margin, vh - rect.height - margin);
        }
        if (top < margin) top = margin;
        setAdjusted({ left, top });
    }, [anchor, result, error, busy]);

    if (!anchor) return null;

    const run = async (action: AIAction) => {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setBusy(action);
        setError(null);
        setResult(null);
        try {
            const out = await runAIAction(action, selectedText, config, ctrl.signal);
            setResult(out);
        } catch (e) {
            if ((e as Error).name === "AbortError") return;
            setError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div
            ref={bubbleRef}
            role="dialog"
            aria-label="AI assist"
            className="fixed z-[90] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-2xl animate-fade-in"
            style={{
                left: adjusted?.left ?? anchor.x,
                top: adjusted?.top ?? anchor.y,
                maxWidth: 380,
                // Hide flicker on first measure: if we haven't adjusted yet,
                // render off-screen-but-painted so the layout pass can size us.
                visibility: adjusted ? "visible" : "hidden",
            }}
        >
            <div className="flex items-center gap-1 px-1 py-1 border-b border-[var(--border-subtle)]">
                {ACTIONS.filter((a) => !a.needsSelection || selectedText).map((a) => (
                    <button
                        key={a.id}
                        onClick={() => run(a.id)}
                        disabled={busy !== null}
                        title={a.label}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 ${busy === a.id ? "bg-[var(--bg-hover)]" : ""}`}
                    >
                        <span className={`material-symbols-outlined text-[14px] ${busy === a.id ? "animate-spin" : ""}`}>
                            {busy === a.id ? "progress_activity" : a.icon}
                        </span>
                        <span>{a.label}</span>
                    </button>
                ))}
                <button
                    onClick={onClose}
                    aria-label="Close AI bubble"
                    className="ml-auto w-6 h-6 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center"
                >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
            </div>

            {error && (
                <div className="px-3 py-2 text-xs text-[var(--danger)] bg-[var(--danger)]/10">
                    {error}
                </div>
            )}

            {result !== null && (
                <div className="p-2 max-w-[380px]">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Suggestion</div>
                    <div className="px-2 py-1.5 text-sm text-[var(--text-primary)] bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {result}
                    </div>
                    <div className="flex gap-1 mt-2 justify-end">
                        <button
                            onClick={() => onInsert(result)}
                            className="px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                        >
                            Insert below
                        </button>
                        <button
                            onClick={() => onReplace(result)}
                            className="px-2 py-1 text-xs rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
                        >
                            Replace
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
