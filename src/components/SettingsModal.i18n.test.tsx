/**
 * The language switcher, end to end through the real Settings modal (I18N-01):
 * the row exists, picking 简体中文 re-renders the whole panel without a reload,
 * the choice is persists, and settings search works in Chinese.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../context/ThemeContext";
import { changeLocale, getLocale } from "../i18n";
import { getAutoCloseBrackets, getLocalePreference } from "../utils/persistence";
import { SettingsModal } from "./SettingsModal";

afterEach(() => {
    cleanup();
    changeLocale("system");
    try { localStorage.clear(); } catch { /* no storage */ }
});

beforeEach(() => {
    try { localStorage.clear(); } catch { /* no storage */ }
});

function openSettings() {
    return render(
        <ThemeProvider>
            <SettingsModal isOpen onClose={() => { }} />
        </ThemeProvider>,
    );
}

const languageRow = () => screen.getByRole("radiogroup", { name: /language|语言/i });

describe("Settings → Appearance → Language", () => {
    it("offers follow-system plus both languages, in their own script", () => {
        openSettings();
        const row = languageRow();
        const buttons = Array.from(row.querySelectorAll("button")).map((b) => b.textContent);

        expect(buttons[0]).toMatch(/^Follow system \(/);   // system locale is en-US in jsdom
        expect(buttons).toContain("English");
        expect(buttons).toContain("简体中文");
        expect(row.querySelector('[aria-checked="true"]')!.textContent).toBe(buttons[0]);
    });

    it("switches the whole panel to Chinese and persists the choice", async () => {
        openSettings();
        fireEvent.click(screen.getByRole("radio", { name: "简体中文" }));

        // Sidebar + header + dialog label, not just the row itself.
        await waitFor(() => expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument());
        expect(screen.getByRole("button", { name: /外观/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /编辑器/ })).toBeInTheDocument();
        expect(screen.getByText("主题")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "English" })).toBeInTheDocument();
        expect(getLocalePreference()).toBe("zh-CN");
        expect(getLocale()).toBe("zh-CN");
    });

    it("switches back to English", async () => {
        changeLocale("zh-CN");
        openSettings();
        fireEvent.click(screen.getByRole("radio", { name: "English" }));

        await waitFor(() => expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument());
        expect(screen.getByText("Theme")).toBeInTheDocument();
        expect(getLocalePreference()).toBe("en");
    });

    it("finds settings by their Chinese label, not just the English keywords", async () => {
        changeLocale("zh-CN");
        openSettings();
        fireEvent.click(screen.getByRole("button", { name: /编辑器/ }));

        const search = screen.getByPlaceholderText("搜索…");
        fireEvent.change(search, { target: { value: "拼写" } });

        // The row is labelled 拼写检查 in Chinese; searching its own label has to
        // match it (the English keyword list alone would not).
        await waitFor(() => expect(screen.getByText("拼写检查")).toBeInTheDocument());
        expect(screen.queryByText("打字机模式")).not.toBeInTheDocument();
    });

    it("still matches the English keywords while the UI is Chinese", async () => {
        changeLocale("zh-CN");
        openSettings();
        fireEvent.click(screen.getByRole("button", { name: /编辑器/ }));

        fireEvent.change(screen.getByPlaceholderText("搜索…"), { target: { value: "vim" } });
        await waitFor(() => expect(screen.getByText("Vim 模式")).toBeInTheDocument());
    });
});

describe("Settings → Editor → Auto-close brackets (#313)", () => {
    it("toggles auto-closing brackets in English and Chinese and broadcasts the change", async () => {
        const events: boolean[] = [];
        const onToggle = (e: Event) => events.push(!!(e as CustomEvent).detail?.enabled);
        window.addEventListener("paperling:auto-close-brackets-toggle", onToggle);
        try {
            openSettings();
            fireEvent.click(screen.getByRole("button", { name: /Editor/ }));
            const toggle = await screen.findByRole("switch", { name: /Auto-close brackets and quotes/i });
            expect(toggle).toHaveAttribute("aria-checked", "true");

            fireEvent.click(toggle);
            expect(toggle).toHaveAttribute("aria-checked", "false");
            expect(getAutoCloseBrackets()).toBe(false);
            expect(events).toEqual([false]);

            changeLocale("zh-CN");
            const zhToggle = await screen.findByRole("switch", { name: /自动补全括号和引号/ });
            expect(zhToggle).toHaveAttribute("aria-checked", "false");
        } finally {
            window.removeEventListener("paperling:auto-close-brackets-toggle", onToggle);
        }
    });
});
