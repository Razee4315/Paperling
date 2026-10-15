import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ensureFontLoaded } from '../fonts';
import { getFontStack, sanitizeCustomFontFamily } from '../utils/fontFamily';
import { parseZoom, stepZoom, ZOOM_DEFAULT } from '../utils/zoom';

export type Theme = 'dark' | 'light' | 'paper' | 'dracula' | 'graphite' | 'nord' | 'midnight';

/** Preset accent colours (issue #172). 'default' leaves the theme's own
 *  accent untouched. Applied as CSS-variable overrides on <html>, so every
 *  theme — existing and future — picks them up without per-theme work. */
export type AccentId = 'default' | 'blue' | 'violet' | 'magenta' | 'green' | 'amber' | 'orange' | 'cyan';

export const ACCENT_CHOICES: Array<{ id: AccentId; name: string; color: string | null }> = [
    { id: 'default', name: 'Default', color: null },
    { id: 'blue', name: 'Blue', color: '#3b82f6' },
    { id: 'violet', name: 'Violet', color: '#8b5cf6' },
    { id: 'magenta', name: 'Magenta', color: '#ec4899' },
    { id: 'green', name: 'Green', color: '#22c55e' },
    { id: 'amber', name: 'Amber', color: '#f59e0b' },
    { id: 'orange', name: 'Orange', color: '#f97316' },
    { id: 'cyan', name: 'Cyan', color: '#06b6d4' },
];

const ACCENT_COLORS: Record<Exclude<AccentId, 'default'>, string> = {
    blue: '#3b82f6',
    violet: '#8b5cf6',
    magenta: '#ec4899',
    green: '#22c55e',
    amber: '#f59e0b',
    orange: '#f97316',
    cyan: '#06b6d4',
};
export type FontFamily = 'inter' | 'merriweather' | 'lora' | 'source-serif' | 'fira-sans' | 'custom';
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

interface ThemeContextType {
    /** The theme on screen. While following the system this is the resolved one. */
    theme: Theme;
    /** Pick a theme explicitly; this stops following the system. */
    setTheme: (theme: Theme) => void;
    /** THEME-01: match the OS light/dark setting, live. */
    followSystem: boolean;
    setFollowSystem: (follow: boolean) => void;
    /** ZOOM-01: multiplier on the reading and editing text size. */
    zoom: number;
    zoomBy: (direction: 1 | -1) => void;
    resetZoom: () => void;
    accent: AccentId;
    setAccent: (accent: AccentId) => void;
    font: FontFamily;
    setFont: (font: FontFamily) => void;
    customFont: string;
    setCustomFont: (font: string) => void;
    fontSize: FontSize;
    setFontSize: (size: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'paperling-theme';
const ZOOM_STORAGE_KEY = 'paperling-zoom';
/** Stored in place of a theme id while the app follows the OS (THEME-01). */
const SYSTEM_THEME = 'system';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The brand pair used while following the system: Paper by day, its warm
 *  dark sibling by night. (Must mirror the pre-paint script in index.html.) */
export const systemTheme = (dark: boolean): Theme => (dark ? 'graphite' : 'paper');

// jsdom and very old webviews have no matchMedia; treat them as light.
const systemPrefersDark = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
const ACCENT_STORAGE_KEY = 'paperling-accent';
const FONT_STORAGE_KEY = 'paperling-font';
const CUSTOM_FONT_STORAGE_KEY = 'paperling-custom-font';
const FONT_SIZE_STORAGE_KEY = 'paperling-font-size';

// Valid values for validation against corrupted localStorage
const VALID_THEMES: Theme[] = ['dark', 'light', 'paper', 'dracula', 'graphite', 'nord', 'midnight'];
const VALID_FONTS: FontFamily[] = ['inter', 'merriweather', 'lora', 'source-serif', 'fira-sans', 'custom'];
const VALID_FONT_SIZES: FontSize[] = ['small', 'medium', 'large', 'xlarge'];

function getValidated<T extends string>(key: string, validValues: T[], fallback: T): T {
    const stored = localStorage.getItem(key);
    if (stored && validValues.includes(stored as T)) {
        return stored as T;
    }
    return fallback;
}

/** A saved theme wins. With nothing saved (a first run) or "system" saved, the
 *  app follows the OS: a cream window on a dark desktop at night was the first
 *  thing a new user saw. Existing profiles are pinned to Paper by
 *  persistence.ts so an update never changes their look. THEME-01. (Must
 *  mirror the inline pre-paint script in index.html.) */
function getInitialFollowSystem(): boolean {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === null || stored === SYSTEM_THEME;
}

function getInitialTheme(): Theme {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) {
        return stored as Theme;
    }
    return systemTheme(systemPrefersDark());
}

function getInitialAccent(): AccentId {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (stored && ACCENT_COLORS[stored as Exclude<AccentId, 'default'>]) {
        return stored as Exclude<AccentId, 'default'>;
    }
    return 'default';
}

/** Relative luminance (WCAG). Used to pick a readable text colour for a
 *  custom accent: buttons render `--accent-text` ON `--accent`. */
function accentLuminance(hex: string): number {
    const h = hex.replace('#', '');
    const channel = (i: number) => {
        const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Inline CSS-variable overrides that recolour the accent. Returns false for
 *  'default' so the caller removes the overrides and the theme's own values
 *  show through again. */
export function applyAccentVars(accent: AccentId, el: HTMLElement): boolean {
    const color = accent === 'default' ? null : ACCENT_COLORS[accent];
    if (!color) {
        el.style.removeProperty('--accent');
        el.style.removeProperty('--accent-hover');
        el.style.removeProperty('--accent-text');
        return false;
    }
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    el.style.setProperty('--accent', color);
    el.style.setProperty('--accent-hover', `rgba(${r}, ${g}, ${b}, 0.85)`);
    // Buttons paint --accent-text on top of --accent, so the pair must be
    // readable: dark ink on light accents, white ink on dark ones.
    el.style.setProperty('--accent-text', accentLuminance(color) > 0.35 ? '#0a0a0a' : '#ffffff');
    return true;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme);
    const [followSystem, setFollowSystemState] = useState<boolean>(getInitialFollowSystem);
    const [zoom, setZoomState] = useState<number>(() => parseZoom(localStorage.getItem(ZOOM_STORAGE_KEY)));

    const [accent, setAccentState] = useState<AccentId>(getInitialAccent);

    const [font, setFontState] = useState<FontFamily>(() =>
        getValidated(FONT_STORAGE_KEY, VALID_FONTS, 'inter')
    );

    const [customFont, setCustomFontState] = useState(() =>
        sanitizeCustomFontFamily(localStorage.getItem(CUSTOM_FONT_STORAGE_KEY) ?? '')
    );

    const [fontSize, setFontSizeState] = useState<FontSize>(() =>
        getValidated(FONT_SIZE_STORAGE_KEY, VALID_FONT_SIZES, 'medium')
    );

    const setTheme = (newTheme: Theme) => {
        setFollowSystemState(false);
        setThemeState(newTheme);
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    };

    const setFollowSystem = (follow: boolean) => {
        setFollowSystemState(follow);
        if (follow) setThemeState(systemTheme(systemPrefersDark()));
        // Turning it off keeps what is on screen as the explicit choice.
        localStorage.setItem(THEME_STORAGE_KEY, follow ? SYSTEM_THEME : theme);
    };

    // Track the OS setting live while following it (sunset auto-switch, or the
    // user flipping dark mode with the app open).
    useEffect(() => {
        if (!followSystem || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia(DARK_QUERY);
        const sync = () => setThemeState(systemTheme(query.matches));
        sync();
        query.addEventListener('change', sync);
        return () => query.removeEventListener('change', sync);
    }, [followSystem]);

    const zoomBy = useCallback((direction: 1 | -1) => {
        setZoomState((current) => {
            const next = stepZoom(current, direction);
            localStorage.setItem(ZOOM_STORAGE_KEY, String(next));
            return next;
        });
    }, []);
    const resetZoom = useCallback(() => {
        setZoomState(ZOOM_DEFAULT);
        localStorage.setItem(ZOOM_STORAGE_KEY, String(ZOOM_DEFAULT));
    }, []);

    // Ctrl/Cmd + wheel zooms, like every browser and reader. A trackpad pinch
    // arrives as a burst of small ctrl+wheel events, so steps are rate-limited
    // instead of one per event. Not passive: the webview's own page zoom must
    // not run underneath.
    useEffect(() => {
        let last = 0;
        const onWheel = (event: WheelEvent) => {
            // defaultPrevented: the diagram viewer owns ctrl+wheel inside itself.
            if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented || event.deltaY === 0) return;
            event.preventDefault();
            const now = performance.now();
            if (now - last < 90) return;
            last = now;
            zoomBy(event.deltaY < 0 ? 1 : -1);
        };
        window.addEventListener('wheel', onWheel, { passive: false });
        return () => window.removeEventListener('wheel', onWheel);
    }, [zoomBy]);

    useEffect(() => {
        document.documentElement.style.setProperty('--zoom', String(zoom));
        // CodeMirror caches line heights; a resize makes it measure again.
        window.dispatchEvent(new Event('resize'));
    }, [zoom]);

    const setAccent = (newAccent: AccentId) => {
        setAccentState(newAccent);
        localStorage.setItem(ACCENT_STORAGE_KEY, newAccent);
    };

    const setFont = (newFont: FontFamily) => {
        setFontState(newFont);
        localStorage.setItem(FONT_STORAGE_KEY, newFont);
    };

    const setCustomFont = (newFont: string) => {
        const safeFont = sanitizeCustomFontFamily(newFont);
        setCustomFontState(safeFont);
        localStorage.setItem(CUSTOM_FONT_STORAGE_KEY, safeFont);
    };

    const setFontSize = (newSize: FontSize) => {
        setFontSizeState(newSize);
        localStorage.setItem(FONT_SIZE_STORAGE_KEY, newSize);
    };

    // Apply theme, font, font size, and accent to document in a single effect.
    // Also lazy-load the chosen body font's CSS (no-op for the eager Inter
    // default). Runs on mount too, so a persisted non-default font is fetched
    // on launch.
    useEffect(() => {
        ensureFontLoaded(font);
        const el = document.documentElement;
        el.setAttribute('data-theme', theme);
        el.setAttribute('data-font', font);
        el.setAttribute('data-font-size', fontSize);
        el.style.setProperty('--font-custom', getFontStack('custom', customFont));
        applyAccentVars(accent, el);
    }, [theme, font, fontSize, customFont, accent]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, followSystem, setFollowSystem, zoom, zoomBy, resetZoom, accent, setAccent, font, setFont, customFont, setCustomFont, fontSize, setFontSize }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
