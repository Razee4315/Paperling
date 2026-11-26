/**
 * The "?" cheatsheet speaks the UI language (I18N-01). It reads the same
 * `shortcuts.*` entries as Settings → Shortcuts, so wiring it to the dictionary
 * both fixes the untranslated dialog and guarantees the two surfaces agree on a
 * command's name.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { changeLocale } from "../i18n";
import { disableBinding, resetAllBindings, setBindingOverride } from "../config/keybindings";
import { ShortcutCheatsheet } from "./ShortcutCheatsheet";

afterEach(() => {
    cleanup();
    changeLocale("system");
    resetAllBindings();
    try { localStorage.clear(); } catch { /* no storage */ }
});

function openCheatsheet() {
    return render(<ShortcutCheatsheet isOpen onClose={() => { }} />);
}

describe("Keyboard shortcut cheatsheet translations", () => {
    it("renders English by default", () => {
        openCheatsheet();

        expect(screen.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Filter shortcuts…")).toBeInTheDocument();
        expect(screen.getByText("File")).toBeInTheDocument();
        expect(screen.getByText("Editor: Formatting")).toBeInTheDocument();
        expect(screen.getByText("New file (new tab)")).toBeInTheDocument();
        // The footer interleaves the <kbd> chip, so match the dialog's text.
        expect(screen.getByRole("dialog").textContent).toContain("Press Esc to close");
    });

    it("renders Chinese once the locale switches, without a reload", async () => {
        openCheatsheet();
        changeLocale("zh-CN");

        await waitFor(() => expect(screen.getByRole("heading", { name: "快捷键" })).toBeInTheDocument());

        expect(screen.getByPlaceholderText("筛选快捷键…")).toBeInTheDocument();
        expect(screen.getByText("文件")).toBeInTheDocument();
        expect(screen.getByText("编辑器：格式")).toBeInTheDocument();
        expect(screen.getByText("新建文件（新标签页）")).toBeInTheDocument();
        expect(screen.getByRole("dialog").textContent).toContain("按 Esc 关闭");
        expect(screen.getByRole("button", { name: "关闭快捷键表" })).toBeInTheDocument();
    });

    it("filters by the translated description", async () => {
        changeLocale("zh-CN");
        openCheatsheet();

        fireEvent.change(screen.getByPlaceholderText("筛选快捷键…"), { target: { value: "加粗" } });

        await waitFor(() => expect(screen.getByText("加粗（切换）")).toBeInTheDocument());
        expect(screen.queryByText("新建文件（新标签页）")).not.toBeInTheDocument();
    });

    it("shows a translated empty state when nothing matches", async () => {
        changeLocale("zh-CN");
        openCheatsheet();

        fireEvent.change(screen.getByPlaceholderText("筛选快捷键…"), { target: { value: "zzz" } });

        await waitFor(() => expect(screen.getByText("没有匹配“zzz”的快捷键")).toBeInTheDocument());
    });

    it("reflects disabled and newly bound shortcuts dynamically (#293)", async () => {
        setBindingOverride("toggleTextDirection", { key: "r", mod: true, alt: true });
        disableBinding("zenMode");
        openCheatsheet();

        expect(screen.getByText("Switch text direction (Auto / RTL / LTR)")).toBeInTheDocument();
        expect(screen.getByText("Ctrl+Alt+R")).toBeInTheDocument();
        expect(screen.queryByText("Toggle Zen mode (reading canvas only)")).not.toBeInTheDocument();
    });
});
