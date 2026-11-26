import { useState, useRef, useEffect, useCallback } from 'react';
import { getInstalledFontFamilies } from '../utils/fontDiscovery';
import { useTheme, Theme, FontFamily, FontSize } from '../context/ThemeContext';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { formatZoom, ZOOM_LEVELS } from '../utils/zoom';
import { formatShortcut } from '../config/keybindings';
import { useI18n, type TKey } from '../i18n';

// Theme and size names come from the dictionary (I18N-01), the same entries
// the full settings modal reads, so the two surfaces can never disagree.
const themes: { id: Theme; nameKey: TKey; colors: [string, string] }[] = [
    { id: 'light', nameKey: 'settings.themeLight', colors: ['#ffffff', '#f4f2ee'] },
    { id: 'paper', nameKey: 'settings.themePaper', colors: ['#f5f0e6', '#ebe5d8'] },
    { id: 'graphite', nameKey: 'settings.themeGraphite', colors: ['#1c1917', '#262220'] },
    { id: 'dark', nameKey: 'settings.themeDark', colors: ['#0a0a0a', '#141414'] },
    { id: 'nord', nameKey: 'settings.themeNord', colors: ['#2e3440', '#3b4252'] },
    { id: 'midnight', nameKey: 'settings.themeMidnight', colors: ['#0f172a', '#1e293b'] },
    { id: 'dracula', nameKey: 'settings.themeDracula', colors: ['#282a36', '#44475a'] },
];

const fonts: { id: FontFamily; name: string }[] = [
    { id: 'inter', name: 'Inter' },
    { id: 'merriweather', name: 'Merriweather' },
    { id: 'lora', name: 'Lora' },
    { id: 'source-serif', name: 'Source Serif' },
    { id: 'fira-sans', name: 'Fira Sans' },
    { id: 'custom', name: 'A font on this computer…' },
];

const fontSizes: { id: FontSize; name: string; labelKey: TKey }[] = [
    { id: 'small', name: 'S', labelKey: 'settings.fontSizeSmall' },
    { id: 'medium', name: 'M', labelKey: 'settings.fontSizeMedium' },
    { id: 'large', name: 'L', labelKey: 'settings.fontSizeLarge' },
    { id: 'xlarge', name: 'XL', labelKey: 'settings.fontSizeXlarge' },
];

const sectionTitle = "text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider";

/** A theme tile: a round two-tone swatch with its name. The selection ring sits
 *  on the swatch itself, so the grid stays calm instead of boxing a whole cell. */
function Swatch({ name, colors, selected, onSelect, title }: { name: string; colors: [string, string]; selected: boolean; onSelect: () => void; title?: string }) {
    return (
        <button
            onClick={onSelect}
            aria-pressed={selected}
            title={title ?? name}
            className="group flex flex-col items-center gap-1.5 py-1.5 rounded-lg outline-none"
        >
            <span
                className={`w-9 h-9 rounded-full overflow-hidden flex border transition-shadow ${selected
                    ? 'border-transparent ring-2 ring-offset-2 ring-[var(--accent)] ring-offset-[var(--bg-secondary)]'
                    : 'border-[var(--border)] group-hover:ring-2 group-hover:ring-offset-2 group-hover:ring-[var(--border)] group-hover:ring-offset-[var(--bg-secondary)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)]'
                    }`}
            >
                <span className="w-1/2 h-full" style={{ backgroundColor: colors[0] }}></span>
                <span className="w-1/2 h-full" style={{ backgroundColor: colors[1] }}></span>
            </span>
            <span className={`text-[11px] leading-none ${selected ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{name}</span>
        </button>
    );
}

/**
 * The quick appearance menu behind the gear. SET-05: it had grown into a long
 * column (a 4x2 grid of boxed theme tiles, a six-row font list with a text
 * field, a size row and a zoom row) that needed scrolling on a laptop. It is
 * now three compact groups — theme swatches, one font picker, one text-size
 * row — and a link to the full settings.
 */
export function SettingsMenu() {
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const { theme, setTheme, followSystem, setFollowSystem, zoom, zoomBy, resetZoom, font, setFont, customFont, setCustomFont, fontSize, setFontSize } = useTheme();
    // Lazily-discovered installed font families for the custom-font input
    // (SET-03): probed on first focus, cached per session, filtered natively
    // by the datalist.
    const [fontSuggestions, setFontSuggestions] = useState<string[]>([]);
    const hydrateFontSuggestions = useCallback(() => {
        void getInstalledFontFamilies().then(setFontSuggestions);
    }, []);
    const menuRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const onMenuKeyDown = useDropdownKeyboard(isOpen, panelRef, () => setIsOpen(false));

    // Close menu when clicking outside or pressing Escape
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKey);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen]);

    return (
        <div ref={menuRef} className="relative no-drag">
            {/* Settings Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-label={t("settings.title")}
                data-tour="settings"
                aria-expanded={isOpen}
                aria-haspopup="true"
                className={`chrome-btn flex items-center justify-center w-9 h-8 ${isOpen ? "chrome-btn-on" : ""}`}
                title={t("settings.title")}
            >
                <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>

            {/* Dropdown Menu. z-[70] keeps it above the floating Reader/Code
                mode toggle (z-50, mounted later in the DOM so it wins z-index
                ties); the max-height lets the menu scroll on short screens
                instead of running underneath it. */}
            {isOpen && (
                <div ref={panelRef} onKeyDown={onMenuKeyDown} role="menu" aria-label={t("settings.title")} className="absolute right-0 top-full mt-2 w-72 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-5rem)] z-[70] animate-fade-in-down">
                    {/* Theme */}
                    <div className="px-4 pt-4 pb-3">
                        <div className={`${sectionTitle} mb-2`}>{t("settings.theme")}</div>
                        <div className="grid grid-cols-4 gap-x-1 gap-y-1">
                            {/* THEME-01: follows the OS light/dark setting. */}
                            <Swatch name={t("settings.themeSystem")} colors={['#f5f0e6', '#1c1917']} selected={followSystem} onSelect={() => setFollowSystem(true)} title={t("settings.themeSystemHint")} />
                            {themes.map((th) => (
                                <Swatch key={th.id} name={t(th.nameKey)} colors={th.colors} selected={!followSystem && theme === th.id} onSelect={() => setTheme(th.id)} />
                            ))}
                        </div>
                    </div>

                    {/* Font: one picker instead of a six-row list. */}
                    <div className="px-4 py-3 border-t border-[var(--border)]">
                        <label htmlFor="paperling-font-select" className={`${sectionTitle} block mb-2`}>{t("settings.font")}</label>
                        <div className="relative">
                            <select
                                id="paperling-font-select"
                                value={font}
                                onChange={(e) => {
                                    const next = e.target.value as FontFamily;
                                    setFont(next);
                                    if (next === 'custom') hydrateFontSuggestions();
                                }}
                                className="w-full appearance-none pl-3 pr-9 h-9 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] outline-none focus:border-[var(--accent)] cursor-pointer"
                            >
                                {fonts.map((f) => <option key={f.id} value={f.id}>{f.id === 'custom' ? t("settingsMenu.fontOnThisComputer") : f.name}</option>)}
                            </select>
                            <span className="material-symbols-outlined text-[18px] text-[var(--text-secondary)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">expand_more</span>
                        </div>
                        {font === 'custom' && (
                            <>
                                <input
                                    type="text"
                                    value={customFont}
                                    maxLength={100}
                                    list="paperling-installed-fonts-menu"
                                    onFocus={hydrateFontSuggestions}
                                    onChange={(e) => setCustomFont(e.target.value)}
                                    onBlur={() => setCustomFont(customFont.trim())}
                                    placeholder={t("settings.fontCustomPlaceholder")}
                                    aria-label={t("settings.fontCustomAria")}
                                    className="w-full mt-2 px-3 h-9 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                                />
                                <datalist id="paperling-installed-fonts-menu">
                                    {fontSuggestions.map((f) => <option key={f} value={f} />)}
                                </datalist>
                            </>
                        )}
                    </div>

                    {/* Text size: preset and zoom on one line each, same control shape. */}
                    <div className="px-4 py-3 border-t border-[var(--border)]">
                        <div className={`${sectionTitle} mb-2`}>{t("settingsMenu.textSize")}</div>
                        <div className="flex p-0.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border)]" role="group" aria-label={t("settings.fontSize")}>
                            {fontSizes.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => setFontSize(s.id)}
                                    aria-pressed={fontSize === s.id}
                                    aria-label={t(s.labelKey)}
                                    title={t(s.labelKey)}
                                    className={`flex-1 h-7 rounded-md text-xs transition-colors ${fontSize === s.id
                                        ? 'bg-[var(--accent)] text-[var(--accent-text)] font-semibold shadow-sm'
                                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                        }`}
                                >
                                    {s.name}
                                </button>
                            ))}
                        </div>
                        {/* Zoom (ZOOM-01): the mouse path for Ctrl +/-. Multiplies the size above. */}
                        <div className="flex items-center mt-2.5">
                            <span className="text-sm text-[var(--text-secondary)] flex-1">{t("settingsMenu.zoom")}</span>
                            <button
                                onClick={() => zoomBy(-1)}
                                disabled={zoom <= ZOOM_LEVELS[0]}
                                aria-label={t("shortcuts.item.zoomOut")}
                                title={`${t("shortcuts.item.zoomOut")} (${formatShortcut('zoomOut')})`}
                                className="chrome-btn w-7 h-7 flex items-center justify-center disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined text-[18px]">remove</span>
                            </button>
                            <button
                                onClick={resetZoom}
                                aria-label={t("settingsMenu.zoomResetAria", { zoom: formatZoom(zoom) })}
                                title={`${t("shortcuts.item.zoomReset")} (${formatShortcut('zoomReset')})`}
                                className="chrome-btn min-w-[3.25rem] h-7 px-1.5 text-sm tabular-nums !text-[var(--text-primary)]"
                            >
                                {formatZoom(zoom)}
                            </button>
                            <button
                                onClick={() => zoomBy(1)}
                                disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                                aria-label={t("shortcuts.item.zoomIn")}
                                title={`${t("shortcuts.item.zoomIn")} (${formatShortcut('zoomIn')})`}
                                className="chrome-btn w-7 h-7 flex items-center justify-center disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                        </div>
                    </div>

                    {/* All settings — opens the full settings window (editor, shortcuts, AI, about). */}
                    <div className="p-1.5 border-t border-[var(--border)]">
                        <button
                            onClick={() => { setIsOpen(false); window.dispatchEvent(new CustomEvent("paperling:open-settings")); }}
                            className="w-full flex items-center gap-2 px-2.5 h-9 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px] text-[var(--text-secondary)]">tune</span>
                            <span className="flex-1 text-left">{t("settingsMenu.allSettings")}</span>
                            <kbd className="text-[11px] font-mono text-[var(--text-muted)]">{formatShortcut('settings')}</kbd>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
