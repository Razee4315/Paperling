/**
 * Which language the UI is drawn in (I18N-01).
 *
 * Three moving parts, deliberately separate:
 *  - the stored PREFERENCE (`"system" | Locale`), in localStorage;
 *  - the RESOLVED locale (`Locale`) the dictionaries are looked up in;
 *  - the subscribers (React components + non-React callers of `t`).
 *
 * A listener set rather than a React context: `t()` is called from hooks,
 * utilities and event handlers (toasts, export labels, dialog buttons) that
 * have no component to hang a context off, and a context would also re-render
 * the whole tree on every switch. Components that render text subscribe with
 * `useLocale()`, so only they re-render.
 *
 * The preference is changeable from two directions — `setLocalePreference`
 * directly, or the `paperling:locale-change` window event that follows this
 * repo's settings convention (SettingsModal dispatches it, same as every other
 * toggle) — so both paths land on the same store.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
    getLocalePreference as storedPreference,
    setLocalePreference as storePreference,
} from "../utils/persistence";

export type Locale = "en" | "zh-CN" | "es" | "fr" | "de" | "ja" | "ko" | "pt-BR";
export type LocalePreference = "system" | Locale;

/** Every language the app can render. Order = the order in the settings list. */
export const LOCALES: readonly Locale[] = ["en", "zh-CN", "es", "fr", "de", "ja", "ko", "pt-BR"];

/** Endonyms — a language is always listed in its own language, so someone who
 *  can't read the current UI language can still find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
    en: "English",
    "zh-CN": "简体中文",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
    ja: "日本語",
    ko: "한국어",
    "pt-BR": "Português",
};

const SUBTAG_TO_LOCALE: Record<string, Locale> = {
    en: "en",
    zh: "zh-CN",
    es: "es",
    fr: "fr",
    de: "de",
    ja: "ja",
    ko: "ko",
    pt: "pt-BR",
};

/**
 * Best guess at the user's language before they have chosen one. Only the
 * languages we actually ship are consulted; anything else falls back to
 * English, which is also the dictionary every other locale falls back to.
 */
export function detectSystemLocale(): Locale {
    if (typeof navigator === "undefined") return "en";
    const candidates = [navigator.language, ...(navigator.languages ?? [])];
    for (const tag of candidates) {
        if (!tag) continue;
        const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
        const match = SUBTAG_TO_LOCALE[primary];
        if (match) return match;
    }
    return "en";
}

export function resolveLocale(preference: LocalePreference): Locale {
    return preference === "system" ? detectSystemLocale() : preference;
}

let preference: LocalePreference = storedPreference();
let current: Locale = resolveLocale(preference);
const listeners = new Set<() => void>();

/** `<html lang>` drives hyphenation, font fallback and screen-reader
 *  pronunciation; `data-locale` is there for CSS that wants to know. */
function applyDocumentLocale(locale: Locale): void {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
}
applyDocumentLocale(current);

function emit(): void {
    for (const listener of listeners) listener();
}

export const getLocale = (): Locale => current;
export const getLocalePreference = (): LocalePreference => preference;

export function subscribeLocale(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * Change the stored preference. Persists, re-resolves, re-tags `<html>` and
 * notifies subscribers. Idempotent: re-selecting the current value (or the
 * event echo of our own change) does nothing.
 */
export function changeLocale(next: LocalePreference): void {
    const resolved = resolveLocale(next);
    const changed = next !== preference || resolved !== current;
    preference = next;
    current = resolved;
    storePreference(next);
    applyDocumentLocale(current);
    if (changed) emit();
}

/** React binding: the locale this component should render in. Re-renders the
 *  component when the language changes. */
export function useLocale(): Locale {
    return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** React binding for the stored preference (`"system"` or an explicit locale) so
 *  the Language picker updates immediately even when switching between `"system"`
 *  and the locale the OS already resolves to. */
export function useLocalePreference(): LocalePreference {
    return useSyncExternalStore(subscribeLocale, getLocalePreference, getLocalePreference);
}

// Window-event bridge (repo convention for settings): anything can switch the
// language by dispatching `paperling:locale-change` with `{ preference }`.
if (typeof window !== "undefined") {
    window.addEventListener("paperling:locale-change", (e) => {
        const next = (e as CustomEvent<{ preference?: LocalePreference }>).detail?.preference;
        if (next) changeLocale(next);
    });
    // "Follow the system" has to follow OS locale changes mid-session too (mirrors theme sync).
    const syncSystem = () => {
        if (preference === "system") changeLocale("system");
    };
    window.addEventListener("languagechange", syncSystem);
    window.addEventListener("focus", syncSystem);
}

/** Re-resolve a "system" preference once, after mount: the OS locale is only
 *  readable in a browser environment, and this keeps the first paint and the
 *  resolved value in sync even if the module was imported during SSR/tests. */
export function useSystemLocaleSync(): void {
    useEffect(() => {
        if (preference === "system") changeLocale("system");
    }, []);
}
