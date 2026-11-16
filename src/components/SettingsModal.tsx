import { Children, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useTheme, ACCENT_CHOICES, type Theme, type FontFamily, type FontSize } from "../context/ThemeContext";
import { ShortcutSettings } from "./ShortcutSettings";
import { getInstalledFontFamilies } from "../utils/fontDiscovery";
import { IS_MOBILE } from "../utils/platform";
import type { TextDirection } from "../utils/textDirection";
import { isMac } from "../config/keybindings";
import {
    getTypewriterMode, setTypewriterMode,
    getToolbarEnabled, setToolbarEnabled,
    getAIConfig, setAIConfig,
    getAIEnabled, setAIEnabled,
    getWordWrap, setWordWrap,
    getCodeFolding, setCodeFolding,
    getCustomCss, setCustomCss,
    getFileHistory, setFileHistory,
    getSpellCheck, setSpellCheck,
    getLivePreview, setLivePreview,
    getVimMode, setVimMode,
    getAutoSave, setAutoSave,
    getOpenInReader, setOpenInReader,
    getReopenSession, setReopenSession,
    getRemoteImages, setRemoteImages,
    getReaderEditing, setReaderEditing,
    getReadableLineLength, setReadableLineLength,
    getTextDirection, setTextDirection,
    getZenMode, setZenMode,
    getAIHistoryTurns, setAIHistoryTurns, AI_HISTORY_TURNS_MAX,
    getAIIconAnimation, setAIIconAnimation,
} from "../utils/persistence";
import { AI_PROVIDERS, matchProvider, type AIProvider } from "../utils/aiProviders";
import { attachFocusTrap } from "../utils/focusTrap";
import {
    changeLocale,
    detectSystemLocale,
    LOCALES,
    LOCALE_NAMES,
    t,
    useI18n,
    type LocalePreference,
    type TKey,
} from "../i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isValidEndpoint, endpointLeaksKey, runAIAction } from "../utils/aiAssist";
import mascotWave from "../assets/mascot/mascot-wave.png";

// Platform-aware AI shortcut hint (Windows/Linux: Alt+J; macOS: ⌘J). Windows
// can't use Ctrl+J because WebView2 reserves it for its Downloads UI.
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const AI_SHORTCUT = IS_MAC ? "⌘J" : "Alt+J";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type Section = "appearance" | "editor" | "shortcuts" | "ai" | "about";

// Labels are translation KEYS, resolved at render: the list itself is
// module-level (it never changes), the language does.
const sections: Array<{ id: Section; labelKey: TKey; icon: string }> = [
    { id: "appearance", labelKey: "settings.sectionAppearance", icon: "palette" },
    { id: "editor", labelKey: "settings.sectionEditor", icon: "edit" },
    { id: "shortcuts", labelKey: "settings.sectionShortcuts", icon: "keyboard" },
    { id: "ai", labelKey: "settings.sectionAi", icon: "auto_awesome" },
    { id: "about", labelKey: "settings.sectionAbout", icon: "info" },
];

// Settings-search synonyms live in the dictionary (SET-05): they have to be
// searchable in the language being read, so "主题" finds the theme row exactly
// like "theme" does. Translated keywords are appended to the English ones, so
// either language keeps working from either UI language, and the search still
// jumps to the first matching section ("vim" from Appearance finds the Editor
// rows). Kept dictionary-driven across the upstream 1.2.0 merge.
const sectionKeywords = (id: Section): string => t(`settings.keywords.${id}` as TKey);

// Theme names are translated; the ones that are proper nouns (Nord, Dracula)
// simply read the same in every language.
const themes: Array<{ id: Theme; nameKey: TKey; colors: [string, string]; textColor: string; icon?: string }> = [
    { id: "dark", nameKey: "settings.themeDark", colors: ["#0a0a0a", "#141414"], textColor: "#ffffff" },
    { id: "graphite", nameKey: "settings.themeGraphite", colors: ["#1c1917", "#262220"], textColor: "#e7e5e4" },
    { id: "nord", nameKey: "settings.themeNord", colors: ["#2e3440", "#3b4252"], textColor: "#eceff4" },
    { id: "midnight", nameKey: "settings.themeMidnight", colors: ["#0f172a", "#1e293b"], textColor: "#e2e8f0" },
    { id: "light", nameKey: "settings.themeLight", colors: ["#ffffff", "#f4f2ee"], textColor: "#171717" },
    { id: "paper", nameKey: "settings.themePaper", colors: ["#f5f0e6", "#ebe5d8"], textColor: "#3d3d3d" },
    { id: "dracula", nameKey: "settings.themeDracula", colors: ["#282a36", "#44475a"], textColor: "#f8f8f2",},
];

// `stack` mirrors the --font-body value each `[data-font]` sets in index.css, so
// each option can preview itself in its own typeface.
const fonts: Array<{ id: FontFamily; name: string; kindKey: TKey; stack: string }> = [
    { id: "inter", name: "Inter", kindKey: "settings.fontKindSans", stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    { id: "merriweather", name: "Merriweather", kindKey: "settings.fontKindSerif", stack: "'Merriweather', Georgia, 'Times New Roman', serif" },
    { id: "lora", name: "Lora", kindKey: "settings.fontKindSerif", stack: "'Lora', Georgia, 'Times New Roman', serif" },
    { id: "source-serif", name: "Source Serif", kindKey: "settings.fontKindSerif", stack: "'Source Serif 4', Georgia, 'Times New Roman', serif" },
    { id: "fira-sans", name: "Fira Sans", kindKey: "settings.fontKindSans", stack: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
];

const fontSizes: Array<{ id: FontSize; nameKey: TKey; sample: number }> = [
    // Samples match the real reading sizes (they used to show 13/19px for
    // 14/18px text).
    { id: "small", nameKey: "settings.fontSizeSmall", sample: 14 },
    { id: "medium", nameKey: "settings.fontSizeMedium", sample: 16 },
    { id: "large", nameKey: "settings.fontSizeLarge", sample: 18 },
    { id: "xlarge", nameKey: "settings.fontSizeXlarge", sample: 20 },
];

interface ToggleRowProps {
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}

/** A titled card of setting rows. Renders nothing when the search filter has
 *  hidden every row inside it. SET-06. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
    const rows = Children.toArray(children);
    if (rows.length === 0) return null;
    return (
        <section>
            <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{title}</h3>
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] divide-y divide-[var(--border-subtle)] overflow-hidden">
                {rows}
            </div>
        </section>
    );
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="group w-full flex items-center justify-between gap-4 px-3.5 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left"
        >
            <div className="flex flex-col items-start min-w-0">
                <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5">{description}</span>
            </div>
            <span
                className={`relative inline-block w-[42px] h-[24px] rounded-full shrink-0 transition-colors duration-200 ${checked ? "bg-[var(--accent)]" : "bg-[var(--text-muted)]/45 group-hover:bg-[var(--text-muted)]/60"}`}
            >
                <span
                    className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-out ${checked ? "translate-x-[18px]" : "translate-x-0"}`}
                />
            </span>
        </button>
    );
}

const DIRECTION_OPTIONS: Array<{ id: TextDirection; labelKey: TKey }> = [
    { id: "auto", labelKey: "settings.directionAuto" },
    { id: "ltr", labelKey: "settings.directionLtr" },
    { id: "rtl", labelKey: "settings.directionRtl" },
];

/** Shared shape for the two segmented settings rows (direction, language). */
function SegmentedRow<T extends string>({ id, labelKey, hint, value, options, onChange }: {
    id: string;
    labelKey: TKey;
    hint: React.ReactNode;
    value: T;
    options: Array<{ id: T; label: string }>;
    onChange: (v: T) => void;
}) {
    const { t } = useI18n();
    return (
        // Wraps: with a long option label ("跟随系统（简体中文）") the segmented
        // group used to be pushed past the row and clipped by the container's
        // overflow-hidden, hiding the other languages. Row wraps first, then the
        // group wraps its own buttons. I18N-01.
        <div className="w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-3">
            <div className="flex flex-col items-start min-w-0">
                <span id={id} className="text-sm font-medium text-[var(--text-primary)]">{t(labelKey)}</span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</span>
            </div>
            <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] overflow-hidden">
                {options.map((o) => {
                    const active = value === o.id;
                    return (
                        <button
                            key={o.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => onChange(o.id)}
                            className={`px-2.5 py-1 text-xs font-medium transition-colors ${active
                                ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"}`}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Three-way choice in the same row shape as ToggleRow; a radiogroup so screen
// readers announce it as one setting with the current value. BIDI-02.
function DirectionRow({ value, onChange }: { value: TextDirection; onChange: (v: TextDirection) => void }) {
    const { t } = useI18n();
    return (
        <SegmentedRow
            id="setting-text-direction"
            labelKey="settings.textDirection"
            hint={<>{t("settings.textDirectionHint")}{!isMac && !IS_MOBILE && t("settings.textDirectionShortcutHint")}</>}
            value={value}
            options={DIRECTION_OPTIONS.map((o) => ({ id: o.id, label: t(o.labelKey) }))}
            onChange={onChange}
        />
    );
}

/**
 * Interface language (I18N-01). "Follow system" is offered first and is the
 * default, so a fresh install matches the OS; the two concrete languages are
 * listed in their own script, which is what makes the row usable by someone
 * who cannot read the language the app is currently in.
 */
function LanguageRow({ value, onChange }: { value: LocalePreference; onChange: (v: LocalePreference) => void }) {
    const { t } = useI18n();
    const systemLanguage = LOCALE_NAMES[detectSystemLocale()];
    const options: Array<{ id: LocalePreference; label: string }> = [
        { id: "system", label: t("settings.languageSystem", { language: systemLanguage }) },
        ...LOCALES.map((l) => ({ id: l as LocalePreference, label: LOCALE_NAMES[l] })),
    ];
    return (
        <SegmentedRow
            id="setting-language"
            labelKey="settings.language"
            hint={t("settings.languageHint")}
            value={value}
            options={options}
            onChange={onChange}
        />
    );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const { t, preference } = useI18n();
    const [section, setSection] = useState<Section>("appearance");
    const [filter, setFilter] = useState("");
    const { theme, setTheme, followSystem, setFollowSystem, accent, setAccent, font, setFont, customFont, setCustomFont, fontSize, setFontSize } = useTheme();

    const [typewriter, setTypewriterLocal] = useState(getTypewriterMode);
    const [toolbar, setToolbarLocal] = useState(getToolbarEnabled);
    const [wordWrap, setWordWrapLocal] = useState(getWordWrap);
    const [codeFolding, setCodeFoldingLocal] = useState(getCodeFolding);
    const [customCss, setCustomCssLocal] = useState(getCustomCss);
    const [keepHistory, setKeepHistoryLocal] = useState(getFileHistory);
    const [historyCleared, setHistoryCleared] = useState(false);
    const [spellCheck, setSpellCheckLocal] = useState(getSpellCheck);
    const [livePreview, setLivePreviewLocal] = useState(getLivePreview);
    const [vimMode, setVimModeLocal] = useState(getVimMode);
    const [autoSave, setAutoSaveLocal] = useState(getAutoSave);
    const [openInReader, setOpenInReaderLocal] = useState(getOpenInReader);
    const [reopenSession, setReopenSessionLocal] = useState(getReopenSession);
    const [remoteImages, setRemoteImagesLocal] = useState(getRemoteImages);
    const [readerEditing, setReaderEditingLocal] = useState(getReaderEditing);
    const [readableLength, setReadableLengthLocal] = useState(getReadableLineLength);
    const [textDirection, setTextDirectionLocal] = useState(getTextDirection);
    // Installed-font suggestions for the custom-font input. Computed lazily on
    // first focus (never at startup), cached per session; the <datalist> does
    // the type-to-filter natively. SET-03.
    const [fontSuggestions, setFontSuggestions] = useState<string[]>([]);
    const hydrateFontSuggestions = useCallback(() => {
        void getInstalledFontFamilies().then(setFontSuggestions);
    }, []);
    const [zenMode, setZenModeLocal] = useState(getZenMode);

    // The running app's version for the About panel (#148). Read from the Tauri
    // core API rather than a build-time constant so it always reflects the
    // installed binary; empty in a plain browser (`vite dev`), where the row is
    // simply not rendered.
    const [appVersion, setAppVersion] = useState("");

    const [ai, setAi] = useState(getAIConfig);
    const [aiEnabled, setAiEnabledLocal] = useState(getAIEnabled);
    const [aiHistoryTurns, setAiHistoryTurnsLocal] = useState(getAIHistoryTurns);
    const [aiIconAnimation, setAiIconAnimationLocal] = useState(getAIIconAnimation);
    const aiEndpointInvalid = ai.endpoint.length > 0 && !isValidEndpoint(ai.endpoint);
    // Sending a key unencrypted off the machine is refused before the request
    // is made, so surface it here rather than as a failed "Test connection".
    const aiKeyInsecure = endpointLeaksKey(ai.endpoint, ai.apiKey);
    const aiEndpointBad = aiEndpointInvalid || aiKeyInsecure;
    const aiConfigured = !!ai.endpoint && !aiEndpointBad && !!ai.model;

    // Connection-test state for the "Test connection" button (AI-04).
    const [aiTest, setAiTest] = useState<{ state: "idle" | "testing" | "ok" | "error"; msg?: string }>({ state: "idle" });

    // Update an AI field, clear any stale test result, and persist immediately
    // (when the endpoint is empty or valid) so edits survive a close-before-blur.
    const updateAi = (patch: Partial<typeof ai>) => {
        const next = { ...ai, ...patch };
        setAi(next);
        setAiTest({ state: "idle" });
        if (!next.endpoint || isValidEndpoint(next.endpoint)) setAIConfig(next);
    };

    // Derived, not stored: the provider pill is whichever preset the current
    // endpoint equals, so hand-edited endpoints simply select nothing.
    const activeProvider = matchProvider(ai.endpoint);
    // Fills endpoint + default model; the key is deliberately left alone so
    // re-picking a provider never wipes a pasted key.
    const applyProvider = (p: AIProvider) => updateAi({ endpoint: p.endpoint, model: p.defaultModel });

    // Provider ids are data (aiProviders.ts), not a literal union, so the
    // dictionary key is assembled at runtime. An id with no translation — a new
    // provider added before its strings — falls back to the provider's own name
    // instead of printing a raw key like "settings.aiProviderNameFoo".
    const providerText = (group: "aiProviderName" | "aiKeyHint", id: string, fallback: string): string => {
        const key = `settings.${group}${id.charAt(0).toUpperCase()}${id.slice(1)}` as TKey;
        const value = t(key);
        return value === key ? fallback : value;
    };

    const testAIConnection = async () => {
        setAiTest({ state: "testing" });
        try {
            await runAIAction("continue", "Reply with: OK", ai);
            setAiTest({ state: "ok" });
        } catch (e) {
            setAiTest({ state: "error", msg: (e as Error).message });
        }
    };

    const fire = (event: string, enabled: boolean) =>
        window.dispatchEvent(new CustomEvent(event, { detail: { enabled } }));

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
        // Move focus INTO the dialog: the trap only engages once focus is
        // inside the container, and screen readers need the dialog announced.
        // Mirrors the cheatsheet/palette, which focus their filter inputs.
        const searchInput = dialogRef.current?.querySelector<HTMLInputElement>("input[data-settings-search]");
        searchInput?.focus();
        return () => {
            document.removeEventListener("keydown", onKey);
            detach();
        };
    }, [isOpen, onClose]);

    // Resolve the app version once the modal is first opened (#148). Lazily
    // imported so a plain browser session, where the Tauri IPC doesn't exist,
    // doesn't pay for or fail on the import at module load.
    useEffect(() => {
        if (!isOpen || appVersion) return;
        let cancelled = false;
        import("@tauri-apps/api/app")
            .then(({ getVersion }) => getVersion())
            .then((v) => { if (!cancelled) setAppVersion(v); })
            .catch(() => { /* not running under Tauri — the row stays hidden */ });
        return () => { cancelled = true; };
    }, [isOpen, appVersion]);

    // Persist AI fields on close. The endpoint/model/key inputs save on blur,
    // but Escape-to-close or backdrop-click can fire before the input loses
    // focus, dropping the in-flight edit. Refresh persistence on every close
    // transition so unblurred edits survive (only when the endpoint is valid;
    // an invalid URL is left unsaved so the user can fix it on next open).
    const aiRef = useRef(ai);
    aiRef.current = ai;
    useEffect(() => {
        if (isOpen) return; // only fire on open→close transition
        const current = aiRef.current;
        if (current.endpoint && !isValidEndpoint(current.endpoint)) return;
        setAIConfig(current);
    }, [isOpen]);

    if (!isOpen) return null;

    // `matches` takes the English keyword(s) AND the translated row label, so a
    // search works in either language regardless of which one the UI is in.
    const matches = (...texts: string[]) =>
        !filter || texts.some((text) => text.toLowerCase().includes(filter.trim().toLowerCase()));
    // Searching for the section itself ("shortcuts", "keyboard"…) shows every
    // row; a command name ("bold") narrows the list.
    const shortcutRowFilter = /^(shortcuts?|keyboard|key ?bindings?|hotkeys?|rebind)$/i.test(filter.trim()) ? "" : filter;
    const noResults =
        !!filter.trim() &&
        !sections.some((s) => sectionKeywords(s.id).includes(filter.trim().toLowerCase()));

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

            <div
                ref={dialogRef}
                className="settings-shell relative z-10 w-[min(820px,95vw)] h-[min(600px,90dvh)] flex bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
            >
                {/* Font suggestions (SET-03): filled on first focus of the
                    custom-font input from the lazily-discovered installed
                    families; the datalist filters natively as the user types. */}
                <datalist id="paperling-installed-fonts">
                    {fontSuggestions.map((f) => <option key={f} value={f} />)}
                </datalist>
                {/* Sidebar — narrower below `sm` so the content pane keeps a
                    usable width when the 95vw modal shrinks on small screens.
                    On mobile the shell CSS turns this into a horizontal icon
                    rail (full-screen sheet layout). */}
                <aside className="settings-nav w-36 sm:w-48 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col">
                    <div className="px-4 py-3 border-b border-[var(--border)]">
                        <input
                            type="text"
                            value={filter}
                            onChange={(e) => {
                                const next = e.target.value;
                                setFilter(next);
                                const q = next.trim().toLowerCase();
                                if (q && !sectionKeywords(section).includes(q)) {
                                    const hit = sections.find(
                                        (s) => sectionKeywords(s.id).includes(q) && (!IS_MOBILE || (s.id !== "ai" && s.id !== "shortcuts")),
                                    );
                                    if (hit) setSection(hit.id);
                                }
                            }}
                            placeholder={t("settings.searchPlaceholder")}
                            aria-label={t("settings.searchAriaLabel")}
                            data-settings-search
                            className="w-full px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        />
                    </div>
                    <nav className="flex-1 py-2">
                        {/* AI needs an endpoint configured on a keyboard and is
                            switched off by default; on the phone it's just a
                            dead section, so it isn't offered. */}
                        {sections
                            .filter((s) => !IS_MOBILE || (s.id !== "ai" && s.id !== "shortcuts"))
                            .map((s) => (
                            <button
                                key={s.id}
                                data-active={section === s.id}
                                onClick={() => setSection(s.id)}
                                className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${section === s.id
                                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                    }`}
                            >
                                <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                                {t(s.labelKey)}
                            </button>
                        ))}
                    </nav>
                </aside>

                {/* Body. min-h-0 is the load-bearing class: a flex item's
                    default min-height:auto lets this wrapper grow to its
                    content height, overflowing the shell (which clips) —
                    on phones the settings below the fold (custom font…)
                    were unreachable because the pane never scrolled.
                    SET-02. */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
                        <h2 className="text-base font-semibold text-[var(--text-primary)]">
                            {t(sections.find((s) => s.id === section)?.labelKey ?? "settings.title")}
                        </h2>
                        <button onClick={onClose} aria-label={t("settings.close")} className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </header>

                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                        {section === "appearance" && (
                            <>
                                {/* Language first: it is the one setting someone
                                    who cannot read the current UI has to be
                                    able to find. I18N-01. */}
                                {matches("language", t("settings.language")) && (
                                    <section>
                                        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] divide-y divide-[var(--border-subtle)] overflow-hidden">
                                            <LanguageRow
                                                value={preference}
                                                onChange={(v) => {
                                                    changeLocale(v);
                                                    window.dispatchEvent(new CustomEvent("paperling:locale-change", { detail: { preference: v } }));
                                                }}
                                            />
                                        </div>
                                    </section>
                                )}
                                {matches("theme", t("settings.theme")) && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t("settings.theme")}</h3>
                                        <div className="grid grid-cols-4 gap-2">
                                            {/* THEME-01: follows the OS light/dark setting. */}
                                            <button
                                                onClick={() => setFollowSystem(true)}
                                                aria-pressed={followSystem}
                                                className={`flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] transition-all ${followSystem
                                                    ? "ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]"
                                                    : "hover:bg-[var(--bg-hover)]"
                                                    }`}
                                                title={t("settings.themeSystemHint")}
                                            >
                                                <div className="w-12 h-12 rounded-[var(--radius-md)] overflow-hidden border border-[var(--border)] flex">
                                                    <div className="w-1/2 h-full" style={{ backgroundColor: "#f5f0e6" }}></div>
                                                    <div className="w-1/2 h-full" style={{ backgroundColor: "#1c1917" }}></div>
                                                </div>
                                                <span className="text-[11px] text-[var(--text-primary)]">{t("settings.themeSystem")}</span>
                                            </button>
                                            {themes.map((t2) => (
                                                <button
                                                    key={t2.id}
                                                    onClick={() => setTheme(t2.id)}
                                                    aria-pressed={!followSystem && theme === t2.id}
                                                    className={`flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] transition-all ${!followSystem && theme === t2.id
                                                        ? "ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]"
                                                        : "hover:bg-[var(--bg-hover)]"
                                                        }`}
                                                    title={t(t2.nameKey)}
                                                >
                                                    <div className="w-12 h-12 rounded-[var(--radius-md)] overflow-hidden border border-[var(--border)] flex items-center justify-center" style={{ backgroundColor: t2.colors[0] }}>
                                                        <div className="w-1/2 h-full" style={{ backgroundColor: t2.colors[0] }}></div>
                                                        <div className="w-1/2 h-full" style={{ backgroundColor: t2.colors[1] }}></div>
                                                    </div>
                                                    <span className="text-[11px] text-[var(--text-primary)]">{t(t2.nameKey)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                {matches("theme accent color colour", t("settings.accentColor")) && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t("settings.accentColor")}</h3>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {ACCENT_CHOICES.map((a) => (
                                                <button
                                                    key={a.id}
                                                    onClick={() => setAccent(a.id)}
                                                    aria-pressed={accent === a.id}
                                                    title={a.name}
                                                    aria-label={t("settings.accentColorAria", { name: a.name })}
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                                                        accent === a.id
                                                            ? "ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-primary)]"
                                                            : "hover:scale-110"
                                                    }`}
                                                    style={{ backgroundColor: a.color ?? "var(--accent)" }}
                                                >
                                                    {a.id === "default" && (
                                                        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-secondary)" }}>close</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                {matches("font", t("settings.font")) && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t("settings.font")}</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {fonts.map((f) => {
                                                const active = font === f.id;
                                                return (
                                                    <button
                                                        key={f.id}
                                                        onClick={() => setFont(f.id)}
                                                        aria-pressed={active}
                                                        className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-all ${active
                                                            ? "border-[var(--accent)] bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]"
                                                            : "border-[var(--border)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                                                            }`}
                                                    >
                                                        <span className="min-w-0">
                                                            <span className="block text-[15px] leading-tight text-[var(--text-primary)] truncate" style={{ fontFamily: f.stack }}>{f.name}</span>
                                                            <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">{t(f.kindKey)}</span>
                                                        </span>
                                                        {active && <span className="material-symbols-outlined text-[18px] text-[var(--accent)] shrink-0">check</span>}
                                                    </button>
                                                );
                                            })}
                                            <div className={`col-span-2 flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border transition-all ${font === "custom"
                                                ? "border-[var(--accent)] bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]"
                                                : "border-[var(--border)]"
                                                }`}>
                                                <button
                                                    type="button"
                                                    onClick={() => setFont("custom")}
                                                    aria-pressed={font === "custom"}
                                                    className="shrink-0 text-left"
                                                >
                                                    <span className="block text-[15px] leading-tight text-[var(--text-primary)]">{t("settings.fontCustom")}</span>
                                                    <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">{t("settings.fontCustomKind")}</span>
                                                </button>
                                                <input
                                                    type="text"
                                                    value={customFont}
                                                    maxLength={100}
                                                    list="paperling-installed-fonts"
                                                    onFocus={() => { setFont("custom"); hydrateFontSuggestions(); }}
                                                    onChange={(e) => setCustomFont(e.target.value)}
                                                    onBlur={() => setCustomFont(customFont.trim())}
                                                    placeholder={t("settings.fontCustomPlaceholder")}
                                                    aria-label={t("settings.fontCustomAria")}
                                                    className="min-w-0 flex-1 px-2.5 py-1.5 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                                                    style={{ fontFamily: customFont ? `"${customFont}", 'Inter'` : "'Inter'" }}
                                                />
                                                {font === "custom" && <span className="material-symbols-outlined text-[18px] text-[var(--accent)] shrink-0">check</span>}
                                            </div>
                                        </div>
                                    </section>
                                )}
                                {matches("size", t("settings.fontSize")) && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t("settings.fontSize")}</h3>
                                        <div className="grid grid-cols-4 gap-2">
                                            {fontSizes.map((s) => {
                                                const active = fontSize === s.id;
                                                return (
                                                    <button
                                                        key={s.id}
                                                        onClick={() => setFontSize(s.id)}
                                                        aria-pressed={active}
                                                        className={`flex flex-col items-center justify-center gap-1 py-3 rounded-[var(--radius-md)] border transition-all ${active
                                                            ? "border-[var(--accent)] bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]"
                                                            : "border-[var(--border)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                                                            }`}
                                                    >
                                                        <span className="leading-none text-[var(--text-primary)]" style={{ fontSize: s.sample }}>Aa</span>
                                                        <span className="text-[11px] text-[var(--text-secondary)]">{t(s.nameKey)}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}

                        {section === "editor" && (
                            // SET-06: fourteen switches in one undivided list were hard
                            // to scan. Grouped by what they affect; a group whose rows
                            // are all filtered out by the search disappears with them.
                            <div className="space-y-6">
                                <SettingsGroup title={t("settings.groupWriting")}>
                                    {/* Not offered on mobile: the toolbar is the
                                        phone's only formatting surface, always on. */}
                                    {matches("toolbar", t("settings.toolbar")) && !IS_MOBILE && (
                                        <ToggleRow label={t("settings.toolbar")} description={t("settings.toolbarHint")} checked={toolbar}
                                            onChange={(v) => { setToolbarLocal(v); setToolbarEnabled(v); fire("paperling:toolbar-toggle", v); }} />
                                    )}
                                    {matches("live preview hide markdown symbols syntax wysiwyg", t("settings.livePreview")) && (
                                        <ToggleRow label={t("settings.livePreview")} description={t("settings.livePreviewHint")} checked={livePreview}
                                            onChange={(v) => { setLivePreviewLocal(v); setLivePreview(v); fire("paperling:live-preview-toggle", v); }} />
                                    )}
                                    {matches("spell check", t("settings.spellCheck")) && (
                                        <ToggleRow label={t("settings.spellCheck")} description={t("settings.spellCheckHint")} checked={spellCheck}
                                            onChange={(v) => { setSpellCheckLocal(v); setSpellCheck(v); fire("paperling:spellcheck-toggle", v); }} />
                                    )}
                                    {matches("word wrap", t("settings.wordWrap")) && (
                                        <ToggleRow label={t("settings.wordWrap")} description={t("settings.wordWrapHint")} checked={wordWrap}
                                            onChange={(v) => { setWordWrapLocal(v); setWordWrap(v); fire("paperling:wordwrap-toggle", v); }} />
                                    )}
                                    {matches("folding fold collapse arrows gutter") && !IS_MOBILE && (
                                        <ToggleRow label={t("settings.folding")} description={t("settings.foldingHint")} checked={codeFolding}
                                            onChange={(v) => { setCodeFoldingLocal(v); setCodeFolding(v); fire("paperling:folding-toggle", v); }} />
                                    )}
                                    {/* Typewriter scrolling orbits a physical
                                        keyboard's caret line; on touch it's a
                                        solution without a problem. */}
                                    {matches("typewriter", t("settings.typewriter")) && !IS_MOBILE && (
                                        <ToggleRow label={t("settings.typewriter")} description={t("settings.typewriterHint")} checked={typewriter}
                                            onChange={(v) => { setTypewriterLocal(v); setTypewriterMode(v); fire("paperling:typewriter-toggle", v); }} />
                                    )}
                                    {matches("vim", t("settings.vim")) && (
                                        <ToggleRow label={t("settings.vim")} description={t("settings.vimHint")} checked={vimMode}
                                            onChange={(v) => { setVimModeLocal(v); setVimMode(v); fire("paperling:vim-toggle", v); }} />
                                    )}
                                </SettingsGroup>
                                <SettingsGroup title={t("settings.groupSaving")}>
                                    {matches("autosave", t("settings.autosave")) && (
                                        <ToggleRow label={t("settings.autosave")} description={t("settings.autosaveHint")} checked={autoSave}
                                            onChange={(v) => { setAutoSaveLocal(v); setAutoSave(v); fire("paperling:autosave-toggle", v); }} />
                                    )}
                                    {matches("open files in reader mode", t("settings.openInReader")) && (
                                        // No window event: App reads the flag live at each
                                        // file open (same pattern as toggle-ai-panel).
                                        <ToggleRow label={t("settings.openInReader")} description={t("settings.openInReaderHint")} checked={openInReader}
                                            onChange={(v) => { setOpenInReaderLocal(v); setOpenInReader(v); }} />
                                    )}
                                    {matches("file history versions local backup recover restore timeline", t("settings.keepHistory")) && (
                                        <ToggleRow label={t("settings.keepHistory")} description={t("settings.keepHistoryHint")} checked={keepHistory}
                                            onChange={(v) => { setKeepHistoryLocal(v); setFileHistory(v); }} />
                                    )}
                                    {matches("file history versions clear delete privacy", t("settings.clearHistory")) && (
                                        <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                                            <div className="flex flex-col items-start min-w-0">
                                                <span className="text-sm font-medium text-[var(--text-primary)]">{t("settings.clearHistory")}</span>
                                                <span className="text-[11px] text-[var(--text-muted)] mt-0.5">{t("settings.clearHistoryHint")}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => { void import("../utils/fileHistory").then(({ fileHistory }) => fileHistory.clear()).then(() => setHistoryCleared(true)); }}
                                                className="shrink-0 px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                            >
                                                {historyCleared ? t("settings.cleared") : t("settings.clear")}
                                            </button>
                                        </div>
                                    )}
                                    {matches("reopen last session launch startup recovery", t("settings.reopenSession")) && (
                                        <ToggleRow label={t("settings.reopenSession")} description={t("settings.reopenSessionHint")} checked={reopenSession}
                                            onChange={(v) => { setReopenSessionLocal(v); setReopenSession(v); fire("paperling:reopen-session-toggle", v); }} />
                                    )}
                                </SettingsGroup>
                                <SettingsGroup title={t("settings.groupReading")}>
                                    {matches("readable line length preview width column", t("settings.readableLength")) && (
                                        <ToggleRow label={t("settings.readableLength")} description={t("settings.readableLengthHint")} checked={readableLength}
                                            onChange={(v) => { setReadableLengthLocal(v); setReadableLineLength(v); fire("paperling:readable-toggle", v); }} />
                                    )}
                                    {matches("edit reader wysiwyg rich text", t("settings.readerEditing")) && (
                                        <ToggleRow label={t("settings.readerEditing")} description={t("settings.readerEditingHint")} checked={readerEditing}
                                            onChange={(v) => { setReaderEditingLocal(v); setReaderEditing(v); fire("paperling:reader-editing-toggle", v); }} />
                                    )}
                                    {matches("load remote images privacy badges", t("settings.remoteImages")) && (
                                        <ToggleRow label={t("settings.remoteImages")} description={t("settings.remoteImagesHint")} checked={remoteImages}
                                            onChange={(v) => { setRemoteImagesLocal(v); setRemoteImages(v); fire("paperling:remote-images-toggle", v); }} />
                                    )}
                                    {matches("text direction right to left rtl ltr arabic hebrew persian urdu", t("settings.textDirection")) && (
                                        <DirectionRow value={textDirection}
                                            onChange={(v) => {
                                                setTextDirectionLocal(v);
                                                setTextDirection(v);
                                                window.dispatchEvent(new CustomEvent("paperling:text-direction-change", { detail: { direction: v } }));
                                            }} />
                                    )}
                                    {matches("zen mode", t("settings.zenMode")) && (
                                        <ToggleRow label={t("settings.zenMode")} description={t("settings.zenModeHint")} checked={zenMode}
                                            onChange={(v) => { setZenModeLocal(v); setZenMode(v); fire("paperling:zen-toggle", v); }} />
                                    )}
                                    {matches("custom css style stylesheet theme") && (
                                        <label className="block px-3.5 py-3">
                                            <span className="text-sm font-medium text-[var(--text-primary)]">{t("settings.customCss")}</span>
                                            <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">{t("settings.customCssHint")}</span>
                                            <textarea
                                                value={customCss}
                                                spellCheck={false}
                                                rows={5}
                                                placeholder=".markdown-body h1 { color: tomato; }"
                                                onChange={(e) => {
                                                    setCustomCssLocal(e.target.value);
                                                    setCustomCss(e.target.value);
                                                    window.dispatchEvent(new CustomEvent("paperling:custom-css-change"));
                                                }}
                                                className="mt-2 w-full px-2 py-1.5 font-mono text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-y"
                                            />
                                        </label>
                                    )}
                                </SettingsGroup>
                            </div>
                        )}

                        {noResults && (
                            <p className="text-sm text-[var(--text-secondary)]">{t("settings.noResults", { query: filter.trim() })}</p>
                        )}

                        {section === "shortcuts" && !IS_MOBILE && !noResults && (
                            <ShortcutSettings filter={shortcutRowFilter} />
                        )}

                        {section === "ai" && !IS_MOBILE && (
                            <>
                                <div className="rounded-[var(--radius-lg)] border border-[var(--border)] divide-y divide-[var(--border-subtle)] overflow-hidden">
                                    <ToggleRow label={t("settings.aiEnable")} description={t("settings.aiEnableHint")} checked={aiEnabled}
                                        onChange={(v) => { setAiEnabledLocal(v); setAIEnabled(v); fire("paperling:ai-enabled-toggle", v); }} />
                                    {aiEnabled && (
                                        <ToggleRow label={t("settings.aiAnimateIcon")} description={t("settings.aiAnimateIconHint")} checked={aiIconAnimation}
                                            onChange={(v) => { setAiIconAnimationLocal(v); setAIIconAnimation(v); fire("paperling:ai-icon-animation-toggle", v); }} />
                                    )}
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm text-[var(--text-secondary)]">
                                        {t("settings.aiIntroBefore")}
                                        <kbd className="px-1 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">{AI_SHORTCUT}</kbd>
                                        {t("settings.aiIntroBetween")}
                                        <span className="material-symbols-outlined text-[14px] align-middle">auto_awesome</span>
                                        {t("settings.aiIntroAfter")}
                                    </p>
                                    <span
                                        className={`shrink-0 px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-medium border ${aiEndpointBad
                                            ? "text-[var(--danger)] border-[var(--danger)]"
                                            : aiConfigured
                                                ? "text-[var(--status-saved)] border-[var(--status-saved)]"
                                                : "text-[var(--status-unsaved)] border-[var(--status-unsaved)]"
                                            }`}
                                    >
                                        {aiEndpointInvalid
                                            ? t("settings.aiStatusInvalidEndpoint")
                                            : aiKeyInsecure
                                                ? t("settings.aiStatusInsecure")
                                                : aiConfigured ? t("settings.aiStatusReady") : t("settings.aiStatusUnconfigured")}
                                    </span>
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t("settings.aiProvider")}</span>
                                        <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={t("settings.aiProviderPresets")}>
                                            {AI_PROVIDERS.map((p) => {
                                                const active = activeProvider?.id === p.id;
                                                return (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => applyProvider(p)}
                                                        aria-pressed={active}
                                                        className={`px-3 py-1.5 text-sm rounded-[var(--radius-md)] border transition-colors ${active
                                                            ? "bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]"
                                                            : "border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"}`}
                                                    >
                                                        {providerText("aiProviderName", p.id, p.name)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <span className="block mt-1 text-[11px] text-[var(--text-muted)]">
                                            {t("settings.aiProviderHint")}
                                        </span>
                                    </div>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t("settings.aiEndpoint")}</span>
                                        <input
                                            type="url"
                                            value={ai.endpoint}
                                            onChange={(e) => updateAi({ endpoint: e.target.value })}
                                            placeholder={t("settings.aiEndpointPlaceholder")}
                                            aria-invalid={aiEndpointBad}
                                            className={`mt-1 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none font-mono ${aiEndpointBad ? "border-[var(--danger)] focus:border-[var(--danger)]" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                                        />
                                        {aiEndpointInvalid && (
                                            <span className="block mt-1 text-[11px] text-[var(--danger)]">{t("settings.aiEndpointInvalid")}</span>
                                        )}
                                        {aiKeyInsecure && (
                                            <span className="block mt-1 text-[11px] text-[var(--danger)]">
                                                {t("settings.aiEndpointInsecure")}
                                            </span>
                                        )}
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t("settings.aiModel")}</span>
                                        <input
                                            type="text"
                                            value={ai.model}
                                            onChange={(e) => updateAi({ model: e.target.value })}
                                            placeholder={t("settings.aiModelPlaceholder")}
                                            className="mt-1 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t("settings.aiApiKey")}</span>
                                        <input
                                            type="password"
                                            value={ai.apiKey}
                                            onChange={(e) => updateAi({ apiKey: e.target.value })}
                                            placeholder={activeProvider?.keyOptional
                                                ? t("settings.aiApiKeyNotNeeded")
                                                : activeProvider
                                                    ? t("settings.aiApiKeyNeeded", { provider: providerText("aiProviderName", activeProvider.id, activeProvider.name) })
                                                    : t("settings.aiApiKeyOptional")}
                                            autoComplete="off"
                                            className="mt-1 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono"
                                        />
                                        {activeProvider && (
                                            <span className="block mt-1 text-[11px] text-[var(--text-muted)]">{providerText("aiKeyHint", activeProvider.id, activeProvider.keyHint)}</span>
                                        )}
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t("settings.aiHistoryDepth")}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={AI_HISTORY_TURNS_MAX}
                                            step={1}
                                            value={aiHistoryTurns}
                                            onChange={(e) => {
                                                const n = e.target.valueAsNumber;
                                                if (!Number.isFinite(n)) return;
                                                const clamped = Math.min(AI_HISTORY_TURNS_MAX, Math.max(0, Math.round(n)));
                                                setAiHistoryTurnsLocal(clamped);
                                                setAIHistoryTurns(clamped);
                                            }}
                                            className="mt-1 w-24 px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono"
                                        />
                                        <span className="block mt-1 text-[11px] text-[var(--text-muted)]">
                                            {t("settings.aiHistoryHint")}
                                        </span>
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={testAIConnection}
                                            disabled={!aiConfigured || aiTest.state === "testing"}
                                            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
                                        >
                                            {aiTest.state === "testing" ? t("settings.aiTesting") : t("settings.aiTest")}
                                        </button>
                                        {aiTest.state === "ok" && (
                                            <span className="text-[12px] text-[var(--status-saved)]">{t("settings.aiTestOk")}</span>
                                        )}
                                        {aiTest.state === "error" && (
                                            <span className="text-[12px] text-[var(--danger)] truncate" title={aiTest.msg}>{aiTest.msg}</span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                                        {t("settings.aiPrivacyLead")}<strong>{t("settings.aiPrivacyUnencrypted")}</strong>{t("settings.aiPrivacyMid")}<code>http://localhost:11434/v1/chat/completions</code>{t("settings.aiPrivacyTail")}
                                    </p>
                                </div>
                            </>
                        )}

                        {section === "about" && (
                            <div className="text-sm text-[var(--text-secondary)] space-y-2">
                                <div className="flex items-center gap-3">
                                    <img src="/icon.svg" alt="Paperling" className="w-10 h-10" />
                                    <div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-[var(--text-primary)] font-semibold">Paperling</span>
                                            {/* Convention: the About box reports the running version (#148).
                                                Selectable so it can be pasted straight into a bug report, and
                                                --text-secondary rather than --text-muted because a version people
                                                are meant to read back to you has to be legible in every theme. */}
                                            {appVersion && (
                                                <span className="text-[11px] font-mono text-[var(--text-secondary)] select-text">
                                                    v{appVersion}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px]">{t("settings.aboutTagline")}</div>
                                    </div>
                                </div>
                                <p>{t("settings.aboutBuiltWith")}</p>

                                {/* The maker. Links open in the system browser
                                    via the opener plugin (granted on desktop
                                    and mobile); fall back to a plain anchor in
                                    plain-browser dev mode. */}
                                <div className="pt-3 border-t border-[var(--border-subtle)] text-xs space-y-2">
                                    <div className="text-[var(--text-muted)] uppercase tracking-wider text-[10px] font-semibold">{t("settings.aboutCreatedBy")}</div>
                                    <div className="text-sm font-medium text-[var(--text-primary)]">Saqlain Razee</div>
                                    <div className="flex flex-col gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                openUrl("https://github.com/Razee4315").catch(() => {
                                                    window.open("https://github.com/Razee4315", "_blank");
                                                });
                                            }}
                                            className="btn-press flex items-center gap-2 w-fit text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">code</span>
                                            <span>GitHub — Razee4315</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                openUrl("https://www.linkedin.com/in/saqlainrazee/").catch(() => {
                                                    window.open("https://www.linkedin.com/in/saqlainrazee/", "_blank");
                                                });
                                            }}
                                            className="btn-press flex items-center gap-2 w-fit text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">work</span>
                                            <span>LinkedIn — saqlainrazee</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Keyboard tour steps don't exist on the touch shell. */}
                                {!IS_MOBILE && (
                                    <p>{t("settings.aboutShortcutHintBefore")}<kbd className="px-1 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">?</kbd>{t("settings.aboutShortcutHintAfter")}</p>
                                )}

                                {/* Replay the first-run tour. The mascot makes the row instantly
                                    recognizable as "that welcome thing". App.tsx listens for the event.
                                    Desktop only: the tour spotlights title-bar/status-bar chrome the
                                    phone shell doesn't have, and its card overflowed narrow screens. */}
                                {!IS_MOBILE && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onClose();
                                            window.dispatchEvent(new CustomEvent("paperling:replay-tour"));
                                        }}
                                        className="btn-press mt-3 w-full flex items-center gap-3 px-3.5 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                                    >
                                        <img src={mascotWave} alt="" aria-hidden="true" draggable={false} className="w-10 h-10 object-contain select-none shrink-0" />
                                        <span className="flex flex-col items-start min-w-0">
                                            <span className="text-sm font-medium text-[var(--text-primary)]">{t("settings.aboutReplayTour")}</span>
                                            <span className="text-[11px] text-[var(--text-muted)] mt-0.5">{t("settings.aboutReplayTourHint")}</span>
                                        </span>
                                        <span className="material-symbols-outlined ml-auto text-[18px] text-[var(--text-muted)]">arrow_forward</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
