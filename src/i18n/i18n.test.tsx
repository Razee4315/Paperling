/**
 * i18n core behaviour (I18N-01). The component-level assertions live in
 * SettingsModal.i18n.test.tsx; this file pins the machinery every string
 * depends on: key lookup, fallback, interpolation, locale detection, the
 * persisted preference and the window-event bridge.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import en from "./en";
import zhCN from "./zh-CN";
import {
    DICTS,
    LOCALES,
    changeLocale,
    detectSystemLocale,
    formatNumber,
    getLocale,
    getLocalePreference,
    t,
    tEn,
    useI18n,
    type TKey,
} from "./index";
import { getLocalePreference as storedPreference } from "../utils/persistence";

afterEach(() => {
    cleanup();
    changeLocale("system");
    try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

/** Every leaf key of a dictionary, as dot paths. */
function leafKeys(node: unknown, prefix = ""): string[] {
    if (typeof node === "string" || typeof node === "function") return [prefix];
    if (node && typeof node === "object") {
        return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
            leafKeys(v, prefix ? `${prefix}.${k}` : k),
        );
    }
    return [];
}

describe("dictionaries", () => {
    it("have exactly the same keys in every language", () => {
        // TypeScript already enforces this (every dict is typed as Dict), but the
        // check is cheap and catches a dictionary built through a cast.
        const expectedKeys = leafKeys(en).sort();
        for (const loc of LOCALES) {
            expect(leafKeys(DICTS[loc]).sort(), `key parity for ${loc}`).toEqual(expectedKeys);
        }
    });

    it("has no empty strings and produces non-empty output from plural/template functions", () => {
        for (const loc of LOCALES) {
            const dict = DICTS[loc];
            const walk = (node: unknown, path: string): void => {
                if (typeof node === "string") {
                    expect(node.trim(), `empty translation at ${loc}.${path}`).not.toBe("");
                    return;
                }
                if (typeof node === "function") {
                    const fn = node as (p: Record<string, string | number>) => string;
                    for (const n of [0, 1, 2, 65]) {
                        const out = fn({ count: n, matches: n, files: n, selected: n, total: n, words: n, chars: n, min: n });
                        expect(typeof out === "string" && out.trim().length > 0, `empty fn output at ${loc}.${path}(${n})`).toBe(true);
                    }
                    return;
                }
                if (node && typeof node === "object") {
                    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                        walk(v, path ? `${path}.${k}` : k);
                    }
                }
            };
            walk(dict, "");
        }
    });

    it("keeps placeholders identical across languages", () => {
        // A dropped {name}/{count} in one language silently loses information.
        const placeholders = (value: unknown): string[] =>
            typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [];
        const compare = (a: unknown, b: unknown, loc: string, path = ""): void => {
            if (typeof a === "string" && typeof b === "string") {
                expect(placeholders(b), `placeholder mismatch at ${loc}.${path}`).toEqual(placeholders(a));
                return;
            }
            if (a && b && typeof a === "object" && typeof b === "object") {
                for (const key of Object.keys(a as Record<string, unknown>)) {
                    compare(
                        (a as Record<string, unknown>)[key],
                        (b as Record<string, unknown>)[key],
                        loc,
                        path ? `${path}.${key}` : key,
                    );
                }
            }
        };
        for (const loc of LOCALES) {
            if (loc !== "en") compare(en, DICTS[loc], loc);
        }
    });
});

describe("t()", () => {
    it("renders English by default (jsdom reports en-US)", () => {
        expect(getLocale()).toBe("en");
        expect(t("settings.language")).toBe("Language");
    });

    it("renders Chinese once the locale changes", () => {
        changeLocale("zh-CN");
        expect(t("settings.language")).toBe("语言");
        expect(t("settings.sectionAppearance")).toBe("外观");
    });

    it("interpolates {placeholders}", () => {
        changeLocale("zh-CN");
        expect(t("settings.noResults", { query: "xyz" })).toContain("xyz");
        expect(t("settings.accentColorAria", { name: "Blue" })).toBe("强调色：Blue");
    });

    it("leaves an unknown placeholder alone rather than printing undefined", () => {
        expect(t("settings.noResults")).toContain("{query}");
    });

    it("falls back to English for a key missing at runtime", () => {
        const zh = zhCN as unknown as Record<string, Record<string, unknown>>;
        const saved = zh.settings.sectionAbout;
        delete zh.settings.sectionAbout;
        try {
            changeLocale("zh-CN");
            expect(t("settings.sectionAbout")).toBe("About");
        } finally {
            zh.settings.sectionAbout = saved;
        }
    });
});

describe("tEn()", () => {
    it("returns the English string whatever the active locale is", () => {
        changeLocale("zh-CN");
        expect(t("shortcuts.item.bold")).toBe("加粗");
        expect(tEn("shortcuts.item.bold")).toBe("Bold");
        // Interpolated entries work the same way.
        expect(tEn("settings.noResults", { query: "xyz" })).toBe("No settings match “xyz”.");
    });
});

describe("system locale detection", () => {
    const withLanguage = (language: string, languages: string[], fn: () => void) => {
        const original = { language: navigator.language, languages: navigator.languages };
        Object.defineProperty(navigator, "language", { value: language, configurable: true });
        Object.defineProperty(navigator, "languages", { value: languages, configurable: true });
        try { fn(); } finally {
            Object.defineProperty(navigator, "language", { value: original.language, configurable: true });
            Object.defineProperty(navigator, "languages", { value: original.languages, configurable: true });
        }
    };

    it("maps each supported language tag and respects navigator.languages priority", () => {
        withLanguage("zh-CN", ["zh-CN", "en-US"], () => expect(detectSystemLocale()).toBe("zh-CN"));
        withLanguage("zh-Hans", ["zh-Hans"], () => expect(detectSystemLocale()).toBe("zh-CN"));
        withLanguage("es-MX", ["es-MX", "en-US"], () => expect(detectSystemLocale()).toBe("es"));
        withLanguage("fr-CA", ["fr-CA"], () => expect(detectSystemLocale()).toBe("fr"));
        withLanguage("de-DE", ["de-DE"], () => expect(detectSystemLocale()).toBe("de"));
        withLanguage("ja-JP", ["ja-JP"], () => expect(detectSystemLocale()).toBe("ja"));
        withLanguage("ko-KR", ["ko-KR"], () => expect(detectSystemLocale()).toBe("ko"));
        withLanguage("pt-BR", ["pt-BR"], () => expect(detectSystemLocale()).toBe("pt-BR"));
        withLanguage("pt-PT", ["pt-PT"], () => expect(detectSystemLocale()).toBe("pt-BR"));
        withLanguage("en-GB", ["en-GB"], () => expect(detectSystemLocale()).toBe("en"));
        withLanguage("it-IT", ["it-IT", "ja-JP", "en-US"], () => expect(detectSystemLocale()).toBe("ja"));
        withLanguage("sv-SE", ["sv-SE"], () => expect(detectSystemLocale()).toBe("en"));
    });

    it("resolves a 'system' preference through the OS language and reacts to languagechange", () => {
        withLanguage("zh-CN", ["zh-CN"], () => {
            changeLocale("system");
            expect(getLocale()).toBe("zh-CN");
        });
        // Simulate OS language changing from Japanese (system) while user has Follow system enabled.
        withLanguage("ja-JP", ["ja-JP"], () => {
            changeLocale("system");
            expect(getLocale()).toBe("ja");
        });
        withLanguage("fr-FR", ["fr-FR"], () => {
            window.dispatchEvent(new Event("languagechange"));
            expect(getLocale()).toBe("fr");
        });
        // An explicit choice stays put when the OS language changes.
        changeLocale("de");
        withLanguage("es-ES", ["es-ES"], () => {
            window.dispatchEvent(new Event("languagechange"));
            expect(getLocale()).toBe("de");
        });
    });
});

describe("persistence and side effects", () => {
    it("stores the preference and tags <html lang>", () => {
        changeLocale("zh-CN");
        expect(storedPreference()).toBe("zh-CN");
        expect(document.documentElement.lang).toBe("zh-CN");
        expect(document.documentElement.dataset.locale).toBe("zh-CN");
    });

    it("ignores a hand-edited garbage value in storage", () => {
        localStorage.setItem("paperling:locale", "klingon");
        expect(storedPreference()).toBe("system");
    });

    it("switches on the paperling:locale-change window event", () => {
        window.dispatchEvent(new CustomEvent("paperling:locale-change", { detail: { preference: "zh-CN" } }));
        expect(getLocale()).toBe("zh-CN");
        expect(getLocalePreference()).toBe("zh-CN");
    });

    it("formats numbers in the active locale", () => {
        expect(formatNumber(1234)).toBe((1234).toLocaleString("en"));
        changeLocale("zh-CN");
        expect(formatNumber(1234)).toBe((1234).toLocaleString("zh-CN"));
    });
});

describe("useI18n()", () => {
    function Probe() {
        const { t: tr, locale } = useI18n();
        return (
            <div>
                <span data-testid="locale">{locale}</span>
                <span data-testid="label">{tr("settings.language")}</span>
            </div>
        );
    }

    // The store update lands outside React's own event system here, so the
    // re-render is scheduled rather than synchronous — assert with waitFor
    // instead of assuming it flushed before the next line.
    it("re-renders the calling component when the language changes", async () => {
        render(<Probe />);
        expect(screen.getByTestId("label").textContent).toBe("Language");

        changeLocale("zh-CN");
        await waitFor(() => expect(screen.getByTestId("label").textContent).toBe("语言"));
        expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
    });

    it("re-renders on the window event too, without a reload", async () => {
        render(<Probe />);
        window.dispatchEvent(new CustomEvent("paperling:locale-change", { detail: { preference: "zh-CN" } }));
        await waitFor(() => expect(screen.getByTestId("label").textContent).toBe("语言"));
    });

    it("does not re-render when the same language is selected again", () => {
        const spy = vi.fn();
        function Counting() {
            const { t: tr } = useI18n();
            spy();
            return <span>{tr("common.cancel")}</span>;
        }
        render(<Counting />);
        const before = spy.mock.calls.length;
        changeLocale("en"); // already English
        expect(spy.mock.calls.length).toBe(before);
    });
});

describe("key typing", () => {
    it("keeps t() usable with a computed key", () => {
        const key: TKey = "settings.sectionEditor";
        expect(t(key)).toBe("Editor");
    });

    it("ignores Object.prototype properties during dictionary lookup", () => {
        expect(t("toString" as TKey)).toBe("toString");
        expect(t("constructor" as TKey)).toBe("constructor");
    });
});
