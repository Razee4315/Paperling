import { useState, useRef, useEffect, useCallback } from 'react';
import { getInstalledFontFamilies } from '../utils/fontDiscovery';
import { useTheme, Theme, FontFamily, FontSize } from '../context/ThemeContext';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { useI18n, type TKey } from '../i18n';

// Same labels as the full settings modal: one dictionary entry per theme and
// per size, so the two surfaces can never disagree.
const themes: { id: Theme; nameKey: TKey; colors: [string, string] }[] = [
    { id: 'dark', nameKey: 'settings.themeDark', colors: ['#0a0a0a', '#141414'] },
    { id: 'graphite', nameKey: 'settings.themeGraphite', colors: ['#1c1917', '#262220'] },
    { id: 'nord', nameKey: 'settings.themeNord', colors: ['#2e3440', '#3b4252'] },
    { id: 'midnight', nameKey: 'settings.themeMidnight', colors: ['#0f172a', '#1e293b'] },
    { id: 'light', nameKey: 'settings.themeLight', colors: ['#ffffff', '#f4f2ee'] },
    { id: 'paper', nameKey: 'settings.themePaper', colors: ['#f5f0e6', '#ebe5d8'] },
    { id: 'dracula', nameKey: 'settings.themeDracula', colors: ['#282a36', '#44475a'] },
];

const fonts: { id: FontFamily; name: string; family: string }[] = [
    { id: 'inter', name: 'Inter', family: "'Inter', sans-serif" },
    { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', serif" },
    { id: 'lora', name: 'Lora', family: "'Lora', serif" },
    { id: 'source-serif', name: 'Source Serif', family: "'Source Serif 4', serif" },
    { id: 'fira-sans', name: 'Fira Sans', family: "'Fira Sans', sans-serif" },
];

const fontSizes: { id: FontSize; nameKey: TKey; size: string }[] = [
    { id: 'small', nameKey: 'settings.fontSizeSmall', size: '14px' },
    { id: 'medium', nameKey: 'settings.fontSizeMedium', size: '16px' },
    { id: 'large', nameKey: 'settings.fontSizeLarge', size: '18px' },
    { id: 'xlarge', nameKey: 'settings.fontSizeXlarge', size: '20px' },
];

export function SettingsMenu() {
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const { theme, setTheme, font, setFont, customFont, setCustomFont, fontSize, setFontSize } = useTheme();
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
                aria-expanded={isOpen}
                aria-haspopup="true"
                className="btn-press flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title={t("settings.title")}
            >
                <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>

            {/* Dropdown Menu. z-[70] keeps it above the floating Reader/Code
                mode toggle (z-50, mounted later in the DOM so it wins z-index
                ties); the max-height lets the menu scroll on short screens
                instead of running underneath it. */}
            {isOpen && (
                <div ref={panelRef} onKeyDown={onMenuKeyDown} role="menu" aria-label={t("settings.title")} className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-5rem)] z-[70] animate-fade-in-down">
                    {/* Theme Section */}
                    <div className="p-4 border-b border-[var(--border)]">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            {t("settings.theme")}
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {themes.map((th) => (
                                <button
                                    key={th.id}
                                    onClick={() => setTheme(th.id)}
                                    aria-pressed={theme === th.id}
                                    className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg transition-all ${theme === th.id
                                        ? 'ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]'
                                        : 'hover:bg-[var(--bg-hover)]'
                                        }`}
                                    title={t(th.nameKey)}
                                >
                                    {/* Theme Preview */}
                                    <div
                                        className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--border)] flex items-center justify-center shadow-sm"
                                        style={{ backgroundColor: th.colors[0] }}
                                    >
                                        <div className="w-1/2 h-full" style={{ backgroundColor: th.colors[0] }}></div>
                                        <div className="w-1/2 h-full" style={{ backgroundColor: th.colors[1] }}></div>
                                    </div>
                                    <span
                                        className="text-[11px] font-medium"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {t(th.nameKey)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font Section */}
                    <div className="p-4 border-b border-[var(--border)]">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            {t("settings.font")}
                        </div>
                        <div className="flex flex-col gap-1">
                            {fonts.map((f) => (
                                <button
                                    key={f.id}
                                    onClick={() => setFont(f.id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg transition-all text-sm ${font === f.id
                                        ? 'bg-[var(--accent)] text-[var(--accent-text)] font-medium'
                                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                        }`}
                                    style={{ fontFamily: f.family }}
                                >
                                    {f.name}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setFont('custom')}
                                className={`w-full text-left px-3 py-2 rounded-lg transition-all text-sm ${font === 'custom'
                                    ? 'bg-[var(--accent)] text-[var(--accent-text)] font-medium'
                                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                    }`}
                            >
                                {t("settingsMenu.customSystemFont")}
                            </button>
                            <input
                                type="text"
                                value={customFont}
                                maxLength={100}
                                list="paperling-installed-fonts-menu"
                                onFocus={() => { setFont('custom'); hydrateFontSuggestions(); }}
                                onChange={(e) => setCustomFont(e.target.value)}
                                onBlur={() => setCustomFont(customFont.trim())}
                                placeholder={t("settings.fontCustomPlaceholder")}
                                aria-label={t("settings.fontCustomAria")}
                                className="w-full mt-1 px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                            />
                            <datalist id="paperling-installed-fonts-menu">
                                {fontSuggestions.map((f) => <option key={f} value={f} />)}
                            </datalist>
                        </div>
                    </div>

                    {/* Font Size Section */}
                    <div className="p-4">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            {t("settings.fontSize")}
                        </div>
                        <div className="flex gap-2">
                            {fontSizes.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => setFontSize(s.id)}
                                    className={`flex-1 px-3 py-2 rounded-lg transition-all text-sm text-center ${fontSize === s.id
                                        ? 'bg-[var(--accent)] text-[var(--accent-text)] font-medium'
                                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                        }`}
                                >
                                    {t(s.nameKey)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* More settings — opens the full settings modal (AI, editor toggles, about). */}
                    <div className="p-2 border-t border-[var(--border)]">
                        <button
                            onClick={() => { setIsOpen(false); window.dispatchEvent(new CustomEvent("paperling:open-settings")); }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px]">tune</span>
                            {t("settingsMenu.more")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
