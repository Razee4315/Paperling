import { useEffect, useState } from "react";
import {
    bindingFromEvent,
    findConflict,
    formatBinding,
    formatShortcut,
    isOverridden,
    resetAllBindings,
    setBindingOverride,
    type BindingId,
} from "../config/keybindings";

/**
 * Settings → Shortcuts (SHC-10): rebind any app command. Click a shortcut to
 * record a new combo; Escape cancels. A combo already used elsewhere is
 * refused with the name of the command that owns it — silently stealing a
 * binding would leave the other command unreachable.
 */

const GROUPS: Array<{ title: string; items: Array<{ id: BindingId; label: string }> }> = [
    {
        title: "File & tabs",
        items: [
            { id: "newFile", label: "New file" },
            { id: "openFile", label: "Open file" },
            { id: "save", label: "Save" },
            { id: "saveAs", label: "Save As" },
            { id: "closeTab", label: "Close tab" },
            { id: "reopenClosedTab", label: "Reopen closed tab" },
            { id: "nextTab", label: "Next tab" },
            { id: "prevTab", label: "Previous tab" },
        ],
    },
    {
        title: "View & navigation",
        items: [
            { id: "palette", label: "Command palette" },
            { id: "gotoLine", label: "Go to line" },
            { id: "toggleMode", label: "Toggle Reader / Code" },
            { id: "toggleSplit", label: "Toggle split view" },
            { id: "zenMode", label: "Zen mode" },
            { id: "fullscreen", label: "Fullscreen" },
            { id: "toggleFileExplorer", label: "File explorer" },
            { id: "toggleTOC", label: "Outline" },
            { id: "searchInFolder", label: "Search in files" },
            { id: "settings", label: "Settings" },
        ],
    },
    {
        title: "Editing",
        items: [
            { id: "bold", label: "Bold" },
            { id: "italic", label: "Italic" },
            { id: "link", label: "Insert link" },
            { id: "blockquote", label: "Toggle blockquote" },
            { id: "find", label: "Find" },
            { id: "replace", label: "Find and replace" },
            { id: "selectNextOccurrence", label: "Select next occurrence" },
            { id: "toggleTask", label: "Toggle task checkbox" },
        ],
    },
];

const LABELS = new Map(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label] as const)));

export function ShortcutSettings({ filter }: { filter: string }) {
    const [recording, setRecording] = useState<BindingId | null>(null);
    const [error, setError] = useState<{ id: BindingId; message: string } | null>(null);
    // Re-render after any change (overrides live in the config module).
    const [, setVersion] = useState(0);

    useEffect(() => {
        const bump = () => setVersion((v) => v + 1);
        window.addEventListener("paperling:keybindings-changed", bump);
        return () => window.removeEventListener("paperling:keybindings-changed", bump);
    }, []);

    // Capture phase + stopPropagation: while recording, the pressed combo must
    // not ALSO run its current command (or close the dialog).
    useEffect(() => {
        if (!recording) return;
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") {
                setRecording(null);
                return;
            }
            const binding = bindingFromEvent(e);
            if (!binding) {
                if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
                    setError({ id: recording, message: "Use a modifier (Ctrl, Alt, ⌘…) or a function key" });
                }
                return;
            }
            const conflict = findConflict(recording, binding);
            if (conflict) {
                setError({
                    id: recording,
                    message: `${formatBinding(binding)} is already used by "${LABELS.get(conflict) ?? conflict}"`,
                });
                return;
            }
            setBindingOverride(recording, binding);
            setError(null);
            setRecording(null);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [recording]);

    const q = filter.trim().toLowerCase();
    const anyOverride = GROUPS.some((g) => g.items.some((i) => isOverridden(i.id)));

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-secondary)]">
                    Click a shortcut, then press the new combination. Esc cancels.
                </p>
                <button
                    onClick={() => { resetAllBindings(); setError(null); }}
                    disabled={!anyOverride}
                    className="shrink-0 px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                    Reset all
                </button>
            </div>
            {GROUPS.map((group) => {
                const items = group.items.filter(
                    (i) => !q || i.label.toLowerCase().includes(q) || formatShortcut(i.id).toLowerCase().includes(q),
                );
                if (items.length === 0) return null;
                return (
                    <section key={group.title}>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{group.title}</h3>
                        <ul className="divide-y divide-[var(--border-subtle)] border border-[var(--border)] rounded-[var(--radius-md)]">
                            {items.map((item) => {
                                const isRecording = recording === item.id;
                                return (
                                    <li key={item.id} className="px-3 py-2">
                                        <div className="flex items-center gap-3">
                                            <span className="flex-1 text-sm text-[var(--text-primary)]">{item.label}</span>
                                            {isOverridden(item.id) && !isRecording && (
                                                <button
                                                    onClick={() => setBindingOverride(item.id, null)}
                                                    title="Restore the default shortcut"
                                                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                                                >
                                                    Reset
                                                </button>
                                            )}
                                            <button
                                                onClick={() => {
                                                    setError(null);
                                                    setRecording(isRecording ? null : item.id);
                                                }}
                                                aria-label={`Change shortcut for ${item.label}`}
                                                aria-pressed={isRecording}
                                                className={`min-w-[110px] px-2 py-1 rounded-[var(--radius-sm)] border text-xs font-mono text-center transition-colors ${
                                                    isRecording
                                                        ? "border-[var(--accent)] text-[var(--accent)] animate-pulse"
                                                        : "border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)]"
                                                }`}
                                            >
                                                {isRecording ? "Press keys…" : formatShortcut(item.id)}
                                            </button>
                                        </div>
                                        {error?.id === item.id && (
                                            <p role="alert" className="mt-1 text-[11px] text-[var(--danger)]">{error.message}</p>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}
