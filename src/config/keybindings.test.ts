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
        expect(kb.formatShortcut("fullscreen")).toBe("⌃⌘F");
    });

    it("toggles fullscreen on ⌃⌘F, the key every Mac app uses (FULLSCREEN-02, #262)", async () => {
        const kb = await loadFresh();
        const both = kev({ key: "f", ctrlKey: true, metaKey: true });
        expect(kb.matchesBinding(both, "fullscreen")).toBe(true);
        // ...and it is not a ⌘F: Find must not open as well.
        expect(kb.matchesBinding(both, "find")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "f", metaKey: true }), "find")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "f", metaKey: true }), "fullscreen")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "f", ctrlKey: true }), "fullscreen")).toBe(false);
        // F11 is Show Desktop on a Mac and never reaches the app as fullscreen.
        expect(kb.matchesBinding(kev({ key: "F11" }), "fullscreen")).toBe(false);
    });

    it("fires a recorded ⌃⌘ combo instead of only displaying it (SHC-11)", async () => {
        localStorage.clear();
        const kb = await loadFresh();
        const recorded = kb.bindingFromEvent(kev({ key: "k", code: "KeyK", ctrlKey: true, metaKey: true }));
        expect(recorded).toEqual({ key: "k", mod: true, ctrl: true });
        kb.setBindingOverride("palette", recorded);
        expect(kb.matchesBinding(kev({ key: "k", ctrlKey: true, metaKey: true }), "palette")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "k", metaKey: true }), "palette")).toBe(false);
        // ⌘K is still Link, untouched by the ⌃⌘K above.
        expect(kb.matchesBinding(kev({ key: "k", metaKey: true }), "link")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "k", ctrlKey: true, metaKey: true }), "link")).toBe(false);
        kb.resetAllBindings();
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

    it("keeps fullscreen on F11, and Ctrl+Win combos off the Ctrl bindings", async () => {
        const kb = await loadFresh();
        expect(kb.formatShortcut("fullscreen")).toBe("F11");
        expect(kb.matchesBinding(kev({ key: "F11" }), "fullscreen")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "f", ctrlKey: true, metaKey: true }), "fullscreen")).toBe(false);
        // The OS key held with Ctrl is not our Ctrl+F.
        expect(kb.matchesBinding(kev({ key: "f", ctrlKey: true, metaKey: true }), "find")).toBe(false);
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

describe("user binding overrides (SHC-10)", () => {
    const press = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key, ...init });

    it("a rebind replaces the default (and its aliases) everywhere, and reset restores it", async () => {
        const kb = await import("./keybindings");
        const ctrl = kb.isMac ? { metaKey: true } : { ctrlKey: true };
        kb.resetAllBindings();
        kb.setBindingOverride("palette", { key: "k", mod: true, shift: true });
        expect(kb.matchesBinding(press("K", { ...ctrl, shiftKey: true }), "palette")).toBe(true);
        expect(kb.matchesBinding(press("p", ctrl), "palette")).toBe(false);
        expect(kb.matchesBinding(press("F1"), "palette")).toBe(false); // alias off once rebound
        expect(kb.findConflict("save", { key: "k", mod: true, shift: true })).toBe("palette");
        // Survives a reload of the persisted map.
        kb.__reloadBindingOverrides();
        expect(kb.isOverridden("palette")).toBe(true);
        kb.setBindingOverride("palette", null);
        expect(kb.matchesBinding(press("p", ctrl), "palette")).toBe(true);
        expect(kb.matchesBinding(press("F1"), "palette")).toBe(true);
    });

    it("supports disabling shortcuts (including aliases) and binding toggleTextDirection (#293)", async () => {
        const kb = await import("./keybindings");
        const ctrl = kb.isMac ? { metaKey: true } : { ctrlKey: true };
        kb.resetAllBindings();

        // toggleTextDirection starts unbound (null) by default.
        expect(kb.getBinding("toggleTextDirection")).toBeNull();
        expect(kb.isDisabled("toggleTextDirection")).toBe(true);
        expect(kb.formatShortcut("toggleTextDirection")).toBe("");

        // Binding it persists across reload and participates in conflict detection.
        kb.setBindingOverride("toggleTextDirection", { key: "r", mod: true, alt: true });
        expect(kb.formatShortcut("toggleTextDirection")).toBe(kb.isMac ? "⌥⌘R" : "Ctrl+Alt+R");
        expect(kb.matchesBinding(press("r", { ...ctrl, altKey: true }), "toggleTextDirection")).toBe(true);
        expect(kb.findConflict("save", { key: "r", mod: true, alt: true })).toBe("toggleTextDirection");
        kb.__reloadBindingOverrides();
        expect(kb.isDisabled("toggleTextDirection")).toBe(false);

        // Disabling a built-in binding (even one with aliases like palette/F1) stops both primary and aliases,
        // clears formatShortcut/toCmKey, and removes it from conflict detection.
        kb.disableBinding("palette");
        expect(kb.getBinding("palette")).toBeNull();
        expect(kb.isDisabled("palette")).toBe(true);
        expect(kb.formatShortcut("palette")).toBe("");
        expect(kb.toCmKey("palette")).toBe("");
        expect(kb.matchesBinding(press("p", ctrl), "palette")).toBe(false);
        expect(kb.matchesBinding(press("F1"), "palette")).toBe(false);
        expect(kb.findConflict("save", { key: "p", mod: true })).toBeNull();

        kb.__reloadBindingOverrides();
        expect(kb.isDisabled("palette")).toBe(true);

        // Restoring default brings back primary + alias; disabling toggleTextDirection unbinds it.
        kb.setBindingOverride("palette", null);
        expect(kb.isDisabled("palette")).toBe(false);
        expect(kb.matchesBinding(press("F1"), "palette")).toBe(true);
        kb.disableBinding("toggleTextDirection");
        expect(kb.isDisabled("toggleTextDirection")).toBe(true);
        kb.resetAllBindings();
    });

    it("records physical keys and refuses unmodified combos", async () => {
        const kb = await import("./keybindings");
        const ctrl = kb.isMac ? { metaKey: true } : { ctrlKey: true };
        expect(kb.bindingFromEvent(press("D", { ...ctrl, shiftKey: true, code: "KeyD" }))).toEqual({ key: "d", mod: true, shift: true });
        expect(kb.bindingFromEvent(press("d", { code: "KeyD" }))).toBeNull();
        expect(kb.bindingFromEvent(press("F7", { code: "F7" }))).toEqual({ key: "F7" });
        expect(kb.bindingFromEvent(press("Control", ctrl))).toBeNull();
    });

    it("avoids macOS reserved combos for replace/inlineCode, detects alias conflicts, and supports non-Latin layouts (SHC-13)", async () => {
        setPlatform("MacIntel");
        const macKb = await loadFresh();
        expect(macKb.formatShortcut("replace")).toBe("⌥⌘F");
        expect(macKb.formatShortcut("inlineCode")).toBe("⌃`");

        setPlatform("Win32");
        const winKb = await loadFresh();
        // Alias collision: binding a command to F1 conflicts with `palette`.
        expect(winKb.findConflict("save", { key: "F1" })).toBe("palette");
        // Non-Latin (Cyrillic) layout reports e.key="ы" on physical KeyS -> falls back to e.code.
        expect(winKb.matchesBinding(new KeyboardEvent("keydown", { key: "ы", code: "KeyS", ctrlKey: true }), "save")).toBe(true);
        // Logical Latin layout (Dvorak) reports ASCII "o" on physical KeyS -> stays logical.
        expect(winKb.matchesBinding(new KeyboardEvent("keydown", { key: "o", code: "KeyS", ctrlKey: true }), "save")).toBe(false);
        expect(winKb.matchesBinding(new KeyboardEvent("keydown", { key: "o", code: "KeyS", ctrlKey: true }), "openFile")).toBe(true);
    });
});
