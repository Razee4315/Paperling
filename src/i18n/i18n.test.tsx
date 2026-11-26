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
        // TypeScript already enforces this (zh-CN is typed as Dict), but the
        // check is cheap and catches a dictionary built through a cast.
        expect(leafKeys(zhCN).sort()).toEqual(leafKeys(en).sort());
    });

    it("has no empty strings", () => {
        for (const locale of [en, zhCN]) {
            const walk = (node: unknown, path: string): void => {
                if (typeof node === "string") {
                    expect(node.trim(), `empty translation at ${path}`).not.toBe("");
                    return;
                }
                if (typeof node === "function") return;
                if (node && typeof node === "object") {
                    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                        walk(v, path ? `${path}.${k}` : k);
                    }
                }
            };
            walk(locale, "");
        }
    });

    it("keeps placeholders identical across languages", () => {
        // A dropped {name}/{count} in one language silently loses information.
        const placeholders = (value: unknown): string[] =>
            typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [];
        const compare = (a: unknown, b: unknown, path = ""): void => {
            if (typeof a === "string" && typeof b === "string") {
                expect(placeholders(b), `placeholder mismatch at ${path}`).toEqual(placeholders(a));
                return;
            }
            if (a && b && typeof a === "object" && typeof b === "object") {
                for (const key of Object.keys(a as Record<string, unknown>)) {
                    compare(
                        (a as Record<string, unknown>)[key],
                        (b as Record<string, unknown>)[key],
                        path ? `${path}.${key}` : key,
                    );
                }
            }
        };
        compare(en, zhCN);
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

    it("maps any Chinese tag to zh-CN and anything else to en", () => {
        withLanguage("zh-CN", ["zh-CN", "en-US"], () => expect(detectSystemLocale()).toBe("zh-CN"));
        withLanguage("zh-Hans", ["zh-Hans"], () => expect(detectSystemLocale()).toBe("zh-CN"));
        withLanguage("en-GB", ["en-GB"], () => expect(detectSystemLocale()).toBe("en"));
        withLanguage("fr-FR", ["fr-FR", "en"], () => expect(detectSystemLocale()).toBe("en"));
    });

    it("resolves a 'system' preference through the OS language", () => {
        withLanguage("zh-CN", ["zh-CN"], () => {
            changeLocale("system");
            expect(getLocale()).toBe("zh-CN");
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
