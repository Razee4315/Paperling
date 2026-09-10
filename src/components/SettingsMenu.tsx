import { useState, useRef, useEffect } from 'react';
import { useTheme, Theme, FontFamily, FontSize } from '../context/ThemeContext';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';

const themes: { id: Theme; name: string; colors: [string, string] }[] = [
    { id: 'dark', name: 'Dark', colors: ['#0a0a0a', '#141414'] },
    { id: 'graphite', name: 'Graphite', colors: ['#1c1917', '#262220'] },
    { id: 'nord', name: 'Nord', colors: ['#2e3440', '#3b4252'] },
    { id: 'midnight', name: 'Midnight', colors: ['#0f172a', '#1e293b'] },
    { id: 'light', name: 'Light', colors: ['#ffffff', '#f4f2ee'] },
    { id: 'paper', name: 'Paper', colors: ['#f5f0e6', '#ebe5d8'] },
    { id: 'dracula', name: 'Dracula', colors: ['#282a36', '#44475a'] },
];

const fonts: { id: FontFamily; name: string; family: string }[] = [
    { id: 'inter', name: 'Inter', family: "'Inter', sans-serif" },
    { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', serif" },
    { id: 'lora', name: 'Lora', family: "'Lora', serif" },
    { id: 'source-serif', name: 'Source Serif', family: "'Source Serif 4', serif" },
    { id: 'fira-sans', name: 'Fira Sans', family: "'Fira Sans', sans-serif" },
];

const fontSizes: { id: FontSize; name: string; size: string }[] = [
    { id: 'small', name: 'Small', size: '14px' },
    { id: 'medium', name: 'Medium', size: '16px' },
    { id: 'large', name: 'Large', size: '18px' },
];

export function SettingsMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const { theme, setTheme, font, setFont, customFont, setCustomFont, fontSize, setFontSize } = useTheme();
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
                aria-label="Settings"
                aria-expanded={isOpen}
                aria-haspopup="true"
                className="btn-press flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title="Settings"
            >
                <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>

            {/* Dropdown Menu. z-[70] keeps it above the floating Reader/Code
                mode toggle (z-50, mounted later in the DOM so it wins z-index
                ties); the max-height lets the menu scroll on short screens
                instead of running underneath it. */}
            {isOpen && (
                <div ref={panelRef} onKeyDown={onMenuKeyDown} role="menu" aria-label="Settings" className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-5rem)] z-[70] animate-fade-in-down">
                    {/* Theme Section */}
                    <div className="p-4 border-b border-[var(--border)]">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            Theme
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                            {themes.map((t) => (
                                <button
                                    key={t.id}
                                    onClick={() => setTheme(t.id)}
                                    className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg transition-all ${theme === t.id
                                        ? 'ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]'
                                        : 'hover:bg-[var(--bg-hover)]'
                                        }`}
                                    title={t.name}
                                >
                                    {/* Theme Preview */}
                                    <div
                                        className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--border)] flex items-center justify-center shadow-sm"
                                        style={{ backgroundColor: t.colors[0] }}
                                    >
                                        <div className="w-1/2 h-full" style={{ backgroundColor: t.colors[0] }}></div>
                                        <div className="w-1/2 h-full" style={{ backgroundColor: t.colors[1] }}></div>
                                    </div>
                                    <span
                                        className="text-[11px] font-medium"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {t.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font Section */}
                    <div className="p-4 border-b border-[var(--border)]">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            Font
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
                                Custom system font
                            </button>
                            <input
                                type="text"
                                value={customFont}
                                maxLength={100}
                                onFocus={() => setFont('custom')}
                                onChange={(e) => setCustomFont(e.target.value)}
                                onBlur={() => setCustomFont(customFont.trim())}
                                placeholder="e.g. Atkinson Hyperlegible"
                                aria-label="Custom system font family"
                                className="w-full mt-1 px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                            />
                        </div>
                    </div>

                    {/* Font Size Section */}
                    <div className="p-4">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            Font Size
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
                                    {s.name}
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
                            More settings…
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
