import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ensureFontLoaded } from '../fonts';
import { getFontStack, sanitizeCustomFontFamily } from '../utils/fontFamily';

export type Theme = 'dark' | 'light' | 'paper' | 'dracula';
export type FontFamily = 'inter' | 'merriweather' | 'lora' | 'source-serif' | 'fira-sans' | 'custom';
export type FontSize = 'small' | 'medium' | 'large';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    font: FontFamily;
    setFont: (font: FontFamily) => void;
    customFont: string;
    setCustomFont: (font: string) => void;
    fontSize: FontSize;
    setFontSize: (size: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'paperling-theme';
const FONT_STORAGE_KEY = 'paperling-font';
const CUSTOM_FONT_STORAGE_KEY = 'paperling-custom-font';
const FONT_SIZE_STORAGE_KEY = 'paperling-font-size';

// Valid values for validation against corrupted localStorage
const VALID_THEMES: Theme[] = ['dark', 'light', 'paper', 'dracula'];
const VALID_FONTS: FontFamily[] = ['inter', 'merriweather', 'lora', 'source-serif', 'fira-sans', 'custom'];
const VALID_FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];

function getValidated<T extends string>(key: string, validValues: T[], fallback: T): T {
    const stored = localStorage.getItem(key);
    if (stored && validValues.includes(stored as T)) {
        return stored as T;
    }
    return fallback;
}

/** Theme to start with: a previously saved choice wins; otherwise Paper —
 *  the brand default for first runs (must mirror the inline pre-paint script
 *  in index.html). */
function getInitialTheme(): Theme {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && VALID_THEMES.includes(stored as Theme)) {
        return stored as Theme;
    }
    return 'paper';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme);

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
        setThemeState(newTheme);
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
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

    // Apply theme, font, and font size to document in a single effect. Also
    // lazy-load the chosen body font's CSS (no-op for the eager Inter default).
    // Runs on mount too, so a persisted non-default font is fetched on launch.
    useEffect(() => {
        ensureFontLoaded(font);
        const el = document.documentElement;
        el.setAttribute('data-theme', theme);
        el.setAttribute('data-font', font);
        el.setAttribute('data-font-size', fontSize);
        el.style.setProperty('--font-custom', getFontStack('custom', customFont));
    }, [theme, font, fontSize, customFont]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, font, setFont, customFont, setCustomFont, fontSize, setFontSize }}>
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
