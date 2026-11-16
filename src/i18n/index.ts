/**
 * Translation entry point (I18N-01).
 *
 * `t("settings.language")` — a dot path into the dictionaries, type-checked
 * against the English one, so a typo or a key that only exists in one language
 * is a compile error.
 *
 * Lookup order: current locale → English → the key itself. The last fallback is
 * deliberate: a missing string shows up as `settings.language` in the UI (loud,
 * greppable) instead of rendering nothing at all.
 *
 * React components call `useI18n()`, which subscribes to the locale store and
 * re-renders on a language switch. Non-React callers (toasts, export labels,
 * dialog helpers) call `t` directly.
 */
import en, { type Dict } from "./en";
import zhCN from "./zh-CN";
import { getLocale, getLocalePreference, useLocale, type Locale, type LocalePreference } from "./locale";

export * from "./locale";

const DICTS: Record<Locale, Dict> = { en, "zh-CN": zhCN };

/** Interpolation values: `t("dialog.deleteFile", { name })`. */
export type TParams = Record<string, string | number>;

type Fn = (...args: never[]) => unknown;
type Leaves<T> = {
    [K in keyof T & string]: T[K] extends Fn ? K : T[K] extends object ? `${K}.${Leaves<T[K]>}` : K;
}[keyof T & string];

/** Every valid key, as a dot path ("settings.aiModel"). */
export type TKey = Leaves<Dict>;

type Entry = string | ((params: TParams) => string);

function lookup(dict: Dict, path: string): Entry | undefined {
    let node: unknown = dict;
    for (const part of path.split(".")) {
        if (node == null || typeof node !== "object") return undefined;
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" || typeof node === "function" ? (node as Entry) : undefined;
}

function interpolate(template: string, params?: TParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
}

export function t(key: TKey, params?: TParams): string {
    const entry = lookup(DICTS[getLocale()], key) ?? lookup(en, key);
    if (typeof entry === "function") return entry(params ?? {});
    if (typeof entry === "string") return interpolate(entry, params);
    return key;
}

/**
 * English regardless of the active locale (I18N-01).
 *
 * The settings search matches a query against BOTH the English keyword list and
 * the translated row label, so "bold" finds 加粗 and vice versa. Rows whose
 * label is a dictionary entry (the shortcut list) need the English side of that
 * pair too; this is the lookup for it.
 */
export function tEn(key: TKey, params?: TParams): string {
    const entry = lookup(en, key);
    if (typeof entry === "function") return entry(params ?? {});
    if (typeof entry === "string") return interpolate(entry, params);
    return key;
}

/**
 * Component binding. Returns `t` (stable, reads the current locale at call
 * time) plus the locale itself, and subscribes the calling component so a
 * language switch re-renders its text.
 */
export function useI18n(): { t: typeof t; locale: Locale; preference: LocalePreference } {
    const locale = useLocale();
    const preference = getLocalePreference();
    return { t, locale, preference };
}

export function formatNumber(value: number): string {
    try {
        return new Intl.NumberFormat(getLocale()).format(value);
    } catch {
        return String(value);
    }
}

/** Dates in exported documents and dialogs, in the UI's language. */
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
    const date = typeof value === "number" ? new Date(value) : value;
    try {
        return date.toLocaleDateString(getLocale(), options ?? { year: "numeric", month: "long", day: "numeric" });
    } catch {
        return date.toLocaleDateString();
    }
}
