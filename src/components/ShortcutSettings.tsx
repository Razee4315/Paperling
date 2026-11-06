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
import { tEn, useI18n, type TKey } from "../i18n";

/**
 * Settings → Shortcuts (SHC-10): rebind any app command. Click a shortcut to
 * record a new combo; Escape cancels. A combo already used elsewhere is
 * refused with the name of the command that owns it — silently stealing a
 * binding would leave the other command unreachable.
 *
 * Every visible string comes from the `shortcuts` dictionary (I18N-01): a row's
 * name is `shortcuts.item.<binding id>`, the group heading is
 * `shortcuts.group.*`, and the "?" cheatsheet reads the SAME entries, so an
 * action can never be named one thing here and another there.
 */

/** Groups are keyed by dictionary entry, not by a baked-in English string. */
const GROUPS: Array<{ titleKey: TKey; ids: BindingId[] }> = [
    {
        titleKey: "shortcuts.group.fileTabs",
        ids: ["newFile", "openFile", "save", "saveAs", "closeTab", "reopenClosedTab", "nextTab", "prevTab"],
    },
    {
        titleKey: "shortcuts.group.viewNav",
        ids: [
            "palette", "gotoLine", "toggleMode", "toggleSplit", "zenMode", "fullscreen",
            "zoomIn", "zoomOut", "zoomReset",
            "toggleFileExplorer", "toggleTOC", "searchInFolder", "settings",
        ],
    },
    {
        titleKey: "shortcuts.group.editing",
        ids: [
            "bold", "italic", "strikethrough", "inlineCode",
            "link", "blockquote", "find", "replace",
            "selectNextOccurrence", "toggleTask", "toggleWordWrap",
            "navBack", "navForward",
        ],
    },
];

/** The dictionary key for a command's short name — the binding id. */
const itemKey = (id: BindingId): TKey =>
    `shortcuts.item.${id}` as Extract<TKey, `shortcuts.item.${string}`>;

/** A recorded-combo failure, kept as data so it re-renders in the new language
 *  if the user switches mid-recording instead of staying frozen in the old one. */
type RecordingError =
    | { id: BindingId; kind: "needModifier" }
    | { id: BindingId; kind: "conflict"; binding: string; conflict: BindingId };

export function ShortcutSettings({ filter }: { filter: string }) {
    const { t } = useI18n();
    const [recording, setRecording] = useState<BindingId | null>(null);
    const [error, setError] = useState<RecordingError | null>(null);
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
                    setError({ id: recording, kind: "needModifier" });
                }
                return;
            }
            const conflict = findConflict(recording, binding);
            if (conflict) {
                setError({ id: recording, kind: "conflict", binding: formatBinding(binding), conflict });
                return;
            }
            setBindingOverride(recording, binding);
            setError(null);
            setRecording(null);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [recording]);

    // The settings search matches the translated label AND the English one, so a
    // command stays findable in either language.
    const q = filter.trim().toLowerCase();
    const matches = (id: BindingId) =>
        !q ||
        t(itemKey(id)).toLowerCase().includes(q) ||
        tEn(itemKey(id)).toLowerCase().includes(q) ||
        formatShortcut(id).toLowerCase().includes(q);

    const anyOverride = GROUPS.some((g) => g.ids.some((id) => isOverridden(id)));

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-secondary)]">{t("shortcuts.hint")}</p>
                <button
                    onClick={() => { resetAllBindings(); setError(null); }}
                    disabled={!anyOverride}
                    className="shrink-0 px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                    {t("shortcuts.resetAll")}
                </button>
            </div>
            {GROUPS.map((group) => {
                const ids = group.ids.filter(matches);
                if (ids.length === 0) return null;
                return (
                    <section key={group.titleKey}>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{t(group.titleKey)}</h3>
                        <ul className="divide-y divide-[var(--border-subtle)] border border-[var(--border)] rounded-[var(--radius-md)]">
                            {ids.map((id) => {
                                const label = t(itemKey(id));
                                const isRecording = recording === id;
                                const rowError = error?.id === id ? error : null;
                                return (
                                    <li key={id} className="px-3 py-2">
                                        <div className="flex items-center gap-3">
                                            <span className="flex-1 text-sm text-[var(--text-primary)]">{label}</span>
                                            {isOverridden(id) && !isRecording && (
                                                <button
                                                    onClick={() => setBindingOverride(id, null)}
                                                    title={t("shortcuts.restoreDefault")}
                                                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                                                >
                                                    {t("shortcuts.reset")}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => {
                                                    setError(null);
                                                    setRecording(isRecording ? null : id);
                                                }}
                                                aria-label={t("shortcuts.changeFor", { name: label })}
                                                aria-pressed={isRecording}
                                                className={`min-w-[110px] px-2 py-1 rounded-[var(--radius-sm)] border text-xs font-mono text-center transition-colors ${
                                                    isRecording
                                                        ? "border-[var(--accent)] text-[var(--accent)] animate-pulse"
                                                        : "border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)]"
                                                }`}
                                            >
                                                {isRecording ? t("shortcuts.pressKeys") : formatShortcut(id)}
                                            </button>
                                        </div>
                                        {rowError && (
                                            <p role="alert" className="mt-1 text-[11px] text-[var(--danger)]">
                                                {rowError.kind === "needModifier"
                                                    ? t("shortcuts.needModifier")
                                                    : t("shortcuts.conflict", {
                                                        binding: rowError.binding,
                                                        name: t(itemKey(rowError.conflict)),
                                                    })}
                                            </p>
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
