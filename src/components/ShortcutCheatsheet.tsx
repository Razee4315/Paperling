import { useEffect, useRef, useState } from "react";
import { attachFocusTrap } from "../utils/focusTrap";
import { formatShortcut, formatAliases, withMod, aiShortcutLabel, isMac } from "../config/keybindings";
import { useI18n, type TKey } from "../i18n";
import iconKeyboard from "../assets/mascot/icon-keyboard.png";

interface ShortcutCheatsheetProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Shortcut {
    keys: string;
    /** Dictionary key for the label, resolved at render time so a language
     *  switch re-renders the open cheatsheet (I18N-01). */
    descKey: TKey;
    /** Secondary combo shown as "… or F1" — kept out of `keys` so filtering and
     *  the primary chip stay clean. */
    alsoKeys?: string;
}

interface ShortcutGroup {
    titleKey: TKey;
    items: Shortcut[];
}

// Every displayed shortcut is derived from the central platform config
// (src/config/keybindings.ts) so the cheatsheet can never drift from what the
// handler actually listens for. formatShortcut renders ⌘/⇧/⌥ glyphs on macOS
// and "Ctrl+Shift+…" on Windows/Linux. Labels read the same `shortcuts` entries
// as Settings → Shortcuts; see en.ts/zh-CN.ts for the wording.
const groups: ShortcutGroup[] = [
    {
        titleKey: "shortcuts.group.file",
        items: [
            { keys: formatShortcut("openFile"), descKey: "shortcuts.item.openFile" },
            { keys: formatShortcut("newFile"), descKey: "shortcuts.desc.newFileTab" },
            { keys: formatShortcut("closeTab"), descKey: "shortcuts.item.closeTab", alsoKeys: formatAliases("closeTab")[0] },
            { keys: formatShortcut("save"), descKey: "shortcuts.item.save" },
            { keys: formatShortcut("saveAs"), descKey: "shortcuts.desc.saveAsEllipsis" },
        ],
    },
    {
        titleKey: "shortcuts.group.tabs",
        items: [
            { keys: formatShortcut("newFile"), descKey: "shortcuts.desc.newTab" },
            { keys: formatShortcut("closeTab"), descKey: "shortcuts.item.closeTab", alsoKeys: formatAliases("closeTab")[0] },
            { keys: formatShortcut("reopenClosedTab"), descKey: "shortcuts.item.reopenClosedTab" },
            { keys: formatShortcut("nextTab"), descKey: "shortcuts.item.nextTab" },
            { keys: formatShortcut("prevTab"), descKey: "shortcuts.item.prevTab" },
            // macOS reserves Option+Arrows for word-wise caret movement in
            // every text view, so the app doesn't bind tab switching to it
            // there (SHC-02).
            ...(isMac ? [] : [{ keys: "Alt+←/→", descKey: "shortcuts.desc.prevNextTab" as TKey }]),
            { keys: withMod("1–8"), descKey: "shortcuts.desc.jumpTabN" },
            { keys: withMod("9"), descKey: "shortcuts.desc.jumpLastTab" },
            { keys: formatShortcut("navBack"), descKey: "shortcuts.desc.navBackLong" },
            { keys: formatShortcut("navForward"), descKey: "shortcuts.item.navForward" },
        ],
    },
    {
        titleKey: "shortcuts.group.view",
        items: [
            { keys: formatShortcut("toggleMode"), descKey: "shortcuts.item.toggleMode" },
            { keys: formatShortcut("toggleSplit"), descKey: "shortcuts.item.toggleSplit" },
            { keys: formatShortcut("zenMode"), descKey: "shortcuts.desc.zenLong" },
            { keys: formatShortcut("fullscreen"), descKey: "shortcuts.desc.fullscreenLong" },
            // Zoom landed upstream in 1.1.1; keep the labels in the dictionary
            // so the cheatsheet and Settings → Shortcuts agree (I18N-01).
            { keys: `${formatShortcut("zoomIn")} / ${formatShortcut("zoomOut")}`, descKey: "shortcuts.desc.zoomText" },
            { keys: formatShortcut("zoomReset"), descKey: "shortcuts.item.zoomReset" },
            { keys: formatShortcut("toggleFileExplorer"), descKey: "shortcuts.desc.toggleExplorerLong" },
            { keys: formatShortcut("searchInFolder"), descKey: "shortcuts.desc.searchAcrossLong" },
            { keys: formatShortcut("toggleTOC"), descKey: "shortcuts.desc.toggleOutlineLong" },
            { keys: formatShortcut("palette"), descKey: "shortcuts.item.palette", alsoKeys: formatAliases("palette")[0] },
            { keys: formatShortcut("settings"), descKey: "shortcuts.desc.openSettingsLong" },
            { keys: formatShortcut("cheatsheet"), descKey: "shortcuts.desc.cheatsheetLong" },
        ],
    },
    {
        titleKey: "shortcuts.group.ai",
        items: [
            { keys: aiShortcutLabel, descKey: "shortcuts.desc.aiAssist" },
        ],
    },
    {
        titleKey: "shortcuts.group.format",
        items: [
            { keys: formatShortcut("bold"), descKey: "shortcuts.desc.boldLong" },
            { keys: formatShortcut("italic"), descKey: "shortcuts.desc.italicLong" },
            { keys: formatShortcut("link"), descKey: "shortcuts.item.link" },
            { keys: formatShortcut("blockquote"), descKey: "shortcuts.desc.blockquoteLong" },
        ],
    },
    {
        titleKey: "shortcuts.group.nav",
        items: [
            { keys: "Tab", descKey: "shortcuts.desc.indent" },
            { keys: "Shift+Tab", descKey: "shortcuts.desc.outdent" },
            { keys: "Enter", descKey: "shortcuts.desc.listContinue" },
            { keys: withMod("Click"), descKey: "shortcuts.desc.followLink" },
            { keys: formatShortcut("find"), descKey: "shortcuts.item.find" },
            { keys: formatShortcut("replace"), descKey: "shortcuts.item.replace" },
            { keys: formatShortcut("gotoLine"), descKey: "shortcuts.desc.gotoLineLong" },
            { keys: formatShortcut("selectNextOccurrence"), descKey: "shortcuts.desc.multiCursorLong" },
            { keys: formatShortcut("toggleTask"), descKey: "shortcuts.desc.toggleTaskLong" },
            { keys: formatShortcut("strikethrough"), descKey: "shortcuts.item.strikethrough" },
            { keys: formatShortcut("inlineCode"), descKey: "shortcuts.item.inlineCode" },
            { keys: formatShortcut("toggleWordWrap"), descKey: "shortcuts.item.toggleWordWrap" },
            { keys: isMac ? "⌘⌥[ / ⌘⌥]" : "Ctrl+Shift+[ / ]", descKey: "shortcuts.desc.foldSection" },
            { keys: isMac ? "⌥↑ / ⌥↓" : "Alt+↑ / Alt+↓", descKey: "shortcuts.desc.moveLine" },
            { keys: isMac ? "⇧⌥↓" : "Shift+Alt+↓", descKey: "shortcuts.desc.duplicateLine" },
            { keys: withMod("Shift+K"), descKey: "shortcuts.desc.deleteLine" },
        ],
    },
    {
        titleKey: "shortcuts.group.autoPair",
        items: [
            { keys: "( [ { ` \" '", descKey: "shortcuts.desc.wrapPair" },
            { keys: "* _ ~ =", descKey: "shortcuts.desc.wrapEmphasis" },
            { keys: ") ] } ` \" '", descKey: "shortcuts.desc.typePastCloser" },
            { keys: "Backspace", descKey: "shortcuts.desc.backspacePair" },
        ],
    },
    {
        titleKey: "shortcuts.group.slash",
        items: [
            { keys: "/", descKey: "shortcuts.desc.slashMenu" },
            { keys: "Paste URL on selection", descKey: "shortcuts.desc.pasteUrl" },
            { keys: "Paste rich HTML", descKey: "shortcuts.desc.pasteHtml" },
            { keys: "Paste tab-separated", descKey: "shortcuts.desc.pasteTable" },
        ],
    },
];

const renderKey = (k: string): React.ReactNode => {
    return k.split(/\s+/).map((part, i) => (
        <span key={i} className="inline-flex items-center">
            {i > 0 && <span className="mx-0.5 text-[var(--text-muted)]">+</span>}
            <kbd className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-primary)] shadow-sm">
                {part}
            </kbd>
        </span>
    ));
};

export function ShortcutCheatsheet({ isOpen, onClose }: ShortcutCheatsheetProps) {
    const { t } = useI18n();
    const dialogRef = useRef<HTMLDivElement>(null);
    const [filter, setFilter] = useState("");

    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", handleKey);
        // Trap first (captures the trigger for focus-restore on close), then
        // move focus into the search input. UX-01.
        const detach = attachFocusTrap(dialogRef.current);
        const input = dialogRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        return () => {
            document.removeEventListener("keydown", handleKey);
            detach();
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const q = filter.trim().toLowerCase();
    const filtered = q
        ? groups
            .map((g) => ({
                ...g,
                items: g.items.filter((it) =>
                    t(it.descKey).toLowerCase().includes(q)
                    || it.keys.toLowerCase().includes(q)
                    || !!it.alsoKeys?.toLowerCase().includes(q)),
            }))
            .filter((g) => g.items.length > 0)
        : groups;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="cheatsheet-title">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

            <div
                ref={dialogRef}
                className="cheatsheet-shell relative z-10 w-[min(640px,calc(100vw-1.5rem))] max-h-[80vh] flex flex-col bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
            >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
                    <img src={iconKeyboard} alt="" aria-hidden="true" draggable={false} className="w-8 h-8 object-contain select-none" />
                    <h2 id="cheatsheet-title" className="text-base font-semibold text-[var(--text-primary)]">{t("shortcuts.title")}</h2>
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={t("shortcuts.filterPlaceholder")}
                        aria-label={t("shortcuts.filterAria")}
                        className="ml-auto px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] w-48"
                    />
                    <button
                        onClick={onClose}
                        aria-label={t("shortcuts.close")}
                        className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-5">
                    {filtered.length === 0 ? (
                        <div className="col-span-2 text-center text-[var(--text-secondary)] py-8 text-sm">
                            {t("shortcuts.noMatches", { query: filter })}
                        </div>
                    ) : filtered.map((g) => (
                        <section key={g.titleKey}>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                                {t(g.titleKey)}
                            </h3>
                            <ul className="space-y-1.5">
                                {g.items.map((it, i) => (
                                    <li key={i} className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-[var(--text-primary)]">{t(it.descKey)}</span>
                                        <span className="flex items-center gap-1 shrink-0">
                                            {renderKey(it.keys)}
                                            {it.alsoKeys && (
                                                <>
                                                    <span className="text-[11px] text-[var(--text-muted)]">{t("shortcuts.or")}</span>
                                                    {renderKey(it.alsoKeys)}
                                                </>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>

                <div className="px-5 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                    {t("shortcuts.escToCloseBefore")}<kbd className="px-1 py-0.5 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">Esc</kbd>{t("shortcuts.escToCloseAfter")}
                </div>
            </div>
        </div>
    );
}
