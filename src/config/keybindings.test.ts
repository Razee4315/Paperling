import { describe, it, expect, beforeEach, vi } from "vitest";

// isMac/isWindows are evaluated once at module load from navigator.platform, so
// each platform case stubs the platform and re-imports the module fresh.
function setPlatform(platform: string) {
    Object.defineProperty(globalThis.navigator, "platform", { value: platform, configurable: true });
}

async function loadFresh() {
    vi.resetModules();
    return await import("./keybindings");
}

const kev = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("keybindings on macOS", () => {
    beforeEach(() => setPlatform("MacIntel"));

    it("resolves the primary modifier to Cmd (meta), not Ctrl", async () => {
        const kb = await loadFresh();
        expect(kb.isMac).toBe(true);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true }), "save")).toBe(true);
        // The core bug this fixes: Ctrl+S must NOT save on macOS.
        expect(kb.matchesBinding(kev({ key: "s", ctrlKey: true }), "save")).toBe(false);
    });

    it("keeps tab cycling on a literal Ctrl (⌘Tab is the OS app-switcher)", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "Tab", ctrlKey: true }), "nextTab")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "Tab", metaKey: true }), "nextTab")).toBe(false);
    });

    it("distinguishes shifted from unshifted combos", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true, shiftKey: true }), "saveAs")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true, shiftKey: true }), "save")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true }), "saveAs")).toBe(false);
    });

    it("matches keys case-insensitively (CapsLock)", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "S", metaKey: true }), "save")).toBe(true);
    });

    it("formats shortcuts with macOS glyphs in ⌃⌥⇧⌘ order", async () => {
        const kb = await loadFresh();
        expect(kb.formatShortcut("save")).toBe("⌘S");
        expect(kb.formatShortcut("saveAs")).toBe("⇧⌘S");
        expect(kb.formatShortcut("nextTab")).toBe("⌃Tab");
        expect(kb.formatShortcut("settings")).toBe("⌘,");
        expect(kb.formatShortcut("fullscreen")).toBe("F11");
    });

    it("produces CodeMirror Mod- keys for editor bindings", async () => {
        const kb = await loadFresh();
        expect(kb.toCmKey("bold")).toBe("Mod-b");
        expect(kb.toCmKey("find")).toBe("Mod-f");
        expect(kb.toCmKey("blockquote")).toBe("Mod-/");
    });
});

describe("alias bindings (#147)", () => {
    beforeEach(() => setPlatform("Win32"));

    it("closes a tab on Ctrl+F4 as well as Ctrl+W", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "w", ctrlKey: true }), "closeTab")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "F4", ctrlKey: true }), "closeTab")).toBe(true);
        // Bare F4 and Alt+F4 must NOT close the tab — Alt+F4 closes the window.
        expect(kb.matchesBinding(kev({ key: "F4" }), "closeTab")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "F4", altKey: true }), "closeTab")).toBe(false);
    });

    it("opens the command palette on F1 as well as Ctrl+P", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "p", ctrlKey: true }), "palette")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "F1" }), "palette")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "F1", ctrlKey: true }), "palette")).toBe(false);
    });

    it("keeps aliases scoped to their own action", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "F1" }), "closeTab")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "F4", ctrlKey: true }), "palette")).toBe(false);
        // F11 (fullscreen) must not be swallowed by the F1 alias.
        expect(kb.matchesBinding(kev({ key: "F11" }), "palette")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "F11" }), "fullscreen")).toBe(true);
    });

    it("displays the primary combo, and exposes aliases separately", async () => {
        const kb = await loadFresh();
        expect(kb.formatShortcut("closeTab")).toBe("Ctrl+W");
        expect(kb.formatShortcut("palette")).toBe("Ctrl+P");
        expect(kb.formatAliases("closeTab")).toEqual(["Ctrl+F4"]);
        expect(kb.formatAliases("palette")).toEqual(["F1"]);
        expect(kb.formatAliases("save")).toEqual([]);
    });
});

describe("keybindings on Windows/Linux", () => {
    beforeEach(() => setPlatform("Win32"));

    it("resolves the primary modifier to Ctrl", async () => {
        const kb = await loadFresh();
        expect(kb.isMac).toBe(false);
        expect(kb.matchesBinding(kev({ key: "s", ctrlKey: true }), "save")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true }), "save")).toBe(false);
    });

    it("formats shortcuts as Ctrl+…", async () => {
        const kb = await loadFresh();
        expect(kb.formatShortcut("saveAs")).toBe("Ctrl+Shift+S");
        expect(kb.formatShortcut("nextTab")).toBe("Ctrl+Tab");
        expect(kb.formatShortcut("settings")).toBe("Ctrl+,");
    });

    it("toggles Zen mode on plain F9", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "F9" }), "zenMode")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "F9", ctrlKey: true }), "zenMode")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "F9", shiftKey: true }), "zenMode")).toBe(false);
        expect(kb.formatShortcut("zenMode")).toBe("F9");
        // F9 must not collide with the F1 palette alias or F11 fullscreen.
        expect(kb.matchesBinding(kev({ key: "F9" }), "palette")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "F9" }), "fullscreen")).toBe(false);
    });
});
