/**
 * Settings → Shortcuts speaks the UI language (I18N-01).
 *
 * The panel used to hard-code its headings and row names in English, so the
 * dictionary entries under `shortcuts.*` were dead and the panel stayed English
 * while the rest of the app followed the language setting. These tests pin the
 * wiring: the panel renders from the dictionary, re-renders on a switch, and
 * the search still finds a command by either its English or translated name.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { changeLocale } from "../i18n";
import { resetAllBindings } from "../config/keybindings";
import { ShortcutSettings } from "./ShortcutSettings";

afterEach(() => {
    cleanup();
    changeLocale("system");
    resetAllBindings();
    try { localStorage.clear(); } catch { /* no storage */ }
});

beforeEach(() => {
    try { localStorage.clear(); } catch { /* no storage */ }
    resetAllBindings();
});

function renderPanel(filter = "") {
    return render(<ShortcutSettings filter={filter} />);
}

describe("Settings → Shortcuts translations", () => {
    it("renders English by default", () => {
        renderPanel();

        expect(screen.getByText("Click a shortcut, then press the new combination. Esc cancels.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Reset all" })).toBeInTheDocument();
        expect(screen.getByText("File & tabs")).toBeInTheDocument();
        expect(screen.getByText("View & navigation")).toBeInTheDocument();
        expect(screen.getByText("Editing")).toBeInTheDocument();
        expect(screen.getByText("New file")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Change shortcut for New file" })).toBeInTheDocument();
    });

    it("renders Chinese once the locale switches, without a reload", async () => {
        renderPanel();
        changeLocale("zh-CN");

        await waitFor(() => expect(
            screen.getByText("点一下某个快捷键，然后按下新的组合键。按 Esc 取消。"),
        ).toBeInTheDocument());

        expect(screen.getByRole("button", { name: "全部恢复默认" })).toBeInTheDocument();
        expect(screen.getByText("文件与标签页")).toBeInTheDocument();
        expect(screen.getByText("视图与导航")).toBeInTheDocument();
        expect(screen.getByText("编辑")).toBeInTheDocument();
        expect(screen.getByText("新建文件")).toBeInTheDocument();
        expect(screen.getByText("加粗")).toBeInTheDocument();
        // The aria label is translated too, so a screen reader follows the UI.
        expect(screen.getByRole("button", { name: "修改“新建文件”的快捷键" })).toBeInTheDocument();
    });

    it("filters by the translated label", () => {
        changeLocale("zh-CN");
        renderPanel("加粗");

        expect(screen.getByText("加粗")).toBeInTheDocument();
        expect(screen.queryByText("新建文件")).not.toBeInTheDocument();
        // The group with no match disappears entirely.
        expect(screen.queryByText("文件与标签页")).not.toBeInTheDocument();
    });

    it("still finds a command by its English name while the UI is Chinese", () => {
        // Settings search matches the English label AND the translated one
        // (SET-05); the shortcut rows must not regress that.
        changeLocale("zh-CN");
        renderPanel("bold");

        expect(screen.getByText("加粗")).toBeInTheDocument();
        expect(screen.queryByText("新建文件")).not.toBeInTheDocument();
    });

    it("shows a translated conflict message that relabels on a language switch", async () => {
        renderPanel();
        fireEvent.click(screen.getByRole("button", { name: "Change shortcut for New file" }));
        // Ctrl+S is already taken by Save.
        fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true });

        expect(await screen.findByRole("alert")).toHaveTextContent('Ctrl+S is already used by "Save"');

        // Switching mid-recording must not leave the message in the old language.
        changeLocale("zh-CN");
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ctrl+S 已被“保存”占用"));
    });

    it("asks for a modifier in the active language", async () => {
        changeLocale("zh-CN");
        renderPanel();
        fireEvent.click(screen.getByRole("button", { name: "修改“新建文件”的快捷键" }));
        fireEvent.keyDown(window, { key: "a", code: "KeyA" });

        expect(await screen.findByRole("alert")).toHaveTextContent("请使用修饰键");
    });
});
