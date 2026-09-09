import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useGlobalShortcuts, type ShortcutHandlers } from "./useGlobalShortcuts";

// Unmount between tests so each harness's window keydown listener is removed
// (auto-cleanup isn't configured globally); otherwise listeners stack up.
afterEach(cleanup);

function makeHandlers(over: Partial<ShortcutHandlers> = {}): ShortcutHandlers {
    return {
        handleOpenFile: vi.fn(),
        handleSaveFile: vi.fn(),
        handleSaveAs: vi.fn(),
        handleNewFile: vi.fn(),
        handleToggleMode: vi.fn(),
        handleToggleSplit: vi.fn(),
        toggleFullscreen: vi.fn(),
        toggleZen: vi.fn(),
        handleToggleFileExplorer: vi.fn(),
        handleToggleTOC: vi.fn(),
        openCheatsheet: vi.fn(),
        openPalette: vi.fn(),
        openSettings: vi.fn(),
        hasFile: true,
        content: "hello",
        ...over,
    };
}

function Harness({ handlers }: { handlers: ShortcutHandlers }) {
    useGlobalShortcuts(handlers);
    return null;
}

function press(init: KeyboardEventInit) {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("useGlobalShortcuts", () => {
    let h: ShortcutHandlers;
    beforeEach(() => {
        h = makeHandlers();
        render(<Harness handlers={h} />);
    });

    it("Ctrl+S saves", () => {
        press({ key: "s", ctrlKey: true });
        expect(h.handleSaveFile).toHaveBeenCalledTimes(1);
    });

    it("Ctrl+S still saves with CapsLock on (key reports 'S')", () => {
        // The regression this guards: an unshifted Ctrl+S under CapsLock reports
        // e.key === "S" and used to fall through to nothing.
        press({ key: "S", ctrlKey: true, shiftKey: false });
        expect(h.handleSaveFile).toHaveBeenCalledTimes(1);
        expect(h.handleSaveAs).not.toHaveBeenCalled();
    });

    it("Ctrl+Shift+S triggers Save As, not Save", () => {
        press({ key: "S", ctrlKey: true, shiftKey: true });
        expect(h.handleSaveAs).toHaveBeenCalledTimes(1);
        expect(h.handleSaveFile).not.toHaveBeenCalled();
    });

    it("Ctrl+O / Ctrl+N work case-insensitively", () => {
        press({ key: "O", ctrlKey: true });
        press({ key: "n", ctrlKey: true });
        expect(h.handleOpenFile).toHaveBeenCalledTimes(1);
        expect(h.handleNewFile).toHaveBeenCalledTimes(1);
    });

    it("Ctrl+E toggles mode only when a file is open", () => {
        press({ key: "e", ctrlKey: true });
        expect(h.handleToggleMode).toHaveBeenCalledTimes(1);
    });

    it("Ctrl+P opens the palette and Ctrl+, opens settings", () => {
        press({ key: "p", ctrlKey: true });
        press({ key: ",", ctrlKey: true });
        expect(h.openPalette).toHaveBeenCalledTimes(1);
        expect(h.openSettings).toHaveBeenCalledTimes(1);
    });

    it("F11 toggles fullscreen", () => {
        press({ key: "F11" });
        expect(h.toggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it("F9 toggles Zen mode, with or without a file open", () => {
        press({ key: "F9" });
        expect(h.toggleZen).toHaveBeenCalledTimes(1);
    });

    it("Alt+J dispatches the AI-assist event", () => {
        const onAi = vi.fn();
        window.addEventListener("paperling:ai-assist", onAi);
        press({ key: "j", altKey: true });
        window.removeEventListener("paperling:ai-assist", onAi);
        expect(onAi).toHaveBeenCalledTimes(1);
    });
});

describe("useGlobalShortcuts gating", () => {
    it("does not save when there is no file and no content", () => {
        const h = makeHandlers({ hasFile: false, content: "" });
        render(<Harness handlers={h} />);
        press({ key: "s", ctrlKey: true });
        expect(h.handleSaveFile).not.toHaveBeenCalled();
    });

    it("Ctrl+F opens preview find only in reader mode", () => {
        const h = makeHandlers({ mode: "preview", openPreviewFind: vi.fn() });
        render(<Harness handlers={h} />);
        press({ key: "f", ctrlKey: true });
        expect(h.openPreviewFind).toHaveBeenCalledTimes(1);
    });

    it("Ctrl+F is left to the editor in code mode", () => {
        const h = makeHandlers({ mode: "code", openPreviewFind: vi.fn() });
        render(<Harness handlers={h} />);
        press({ key: "f", ctrlKey: true });
        expect(h.openPreviewFind).not.toHaveBeenCalled();
    });
});
