/**
 * Central, platform-aware keybinding config — the single source of truth for
 * every app shortcut. The window handler (useGlobalShortcuts), the cheatsheet,
 * and the editor's CodeMirror keymap all derive from this so they can never
 * drift (they used to: the cheatsheet showed ⌘S while the handler listened for
 * Ctrl+S, and it even advertised an impossible ⌘Tab).
 *
 * The key idea is the **primary modifier** (`mod`): Cmd (⌘) on macOS, Ctrl
 * elsewhere. A few bindings deliberately opt out of that — tab cycling stays a
 * literal Ctrl on every platform because ⌘Tab is the macOS app-switcher.
 */

export const isMac =
    typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const isWindows =
    typeof navigator !== "undefined" && /Win/.test(navigator.platform);

export interface Binding {
    /** The physical key. Letters/digits are matched case-insensitively (so
     *  CapsLock, which reports an uppercase `key`, doesn't dead-zone them).
     *  Examples: "s", "f", "\\", ",", "/", "?", "F11", "Tab", "ArrowLeft", "1". */
    key: string;
    /** Primary modifier — Cmd on macOS, Ctrl on Windows/Linux. */
    mod?: boolean;
    /** LITERAL Ctrl on every platform (used for tab cycling). */
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
}

/**
 * Every registered binding. Tab jump-by-number (⌘1..9) and the dual AI shortcut
 * (Alt+J / ⌘J) are handled inline in the window handler rather than as single
 * static entries, but their display is derived from helpers below.
 */
export const BINDINGS = {
    // File / tabs
    openFile: { key: "o", mod: true },
    newFile: { key: "n", mod: true },
    closeTab: { key: "w", mod: true },
    save: { key: "s", mod: true },
    saveAs: { key: "s", mod: true, shift: true },
    reopenClosedTab: { key: "t", mod: true, shift: true },

    // View
    toggleMode: { key: "e", mod: true },
    toggleSplit: { key: "\\", mod: true },
    zenMode: { key: "F9" },
    toggleFileExplorer: { key: "e", mod: true, shift: true },
    toggleTOC: { key: "o", mod: true, shift: true },
    searchInFolder: { key: "f", mod: true, shift: true },
    palette: { key: "p", mod: true },
    settings: { key: ",", mod: true },
    fullscreen: { key: "F11" },
    cheatsheet: { key: "?" },

    // Tab cycling — literal Ctrl on ALL platforms (⌘Tab is the OS app-switcher).
    nextTab: { key: "Tab", ctrl: true },
    prevTab: { key: "Tab", ctrl: true, shift: true },
    nextTabPage: { key: "PageDown", ctrl: true },
    prevTabPage: { key: "PageUp", ctrl: true },
    prevTabAlt: { key: "ArrowLeft", alt: true },
    nextTabAlt: { key: "ArrowRight", alt: true },

    // Editor (CodeMirror owns these via toCmKey; find/replace also drive the bar)
    bold: { key: "b", mod: true },
    italic: { key: "i", mod: true },
    link: { key: "k", mod: true },
    blockquote: { key: "/", mod: true },
    find: { key: "f", mod: true },
    replace: { key: "h", mod: true },
} satisfies Record<string, Binding>;

export type BindingId = keyof typeof BINDINGS;

/**
 * Secondary combos that fire the same action as their primary binding, for
 * muscle memory carried in from other apps (#147). Ctrl+F4 is the long-standing
 * Windows "close document" combo, and F1 is VS Code's command-palette alias
 * alongside Ctrl+P.
 *
 * These are matched but NOT displayed: the cheatsheet and menus stay on the
 * primary so they don't turn into a list of synonyms. Alt+F4 (close window) is
 * unaffected — it never reaches this config, the Tauri close-requested handler
 * owns it.
 */
export const ALIASES: Partial<Record<BindingId, Binding[]>> = {
    closeTab: [{ key: "F4", mod: true }],
    palette: [{ key: "F1" }],
};

/** Is the primary modifier (Cmd on Mac, Ctrl elsewhere) the one pressed here? */
export function isModPressed(e: KeyboardEvent): boolean {
    return isMac ? e.metaKey : e.ctrlKey;
}

/** Primary modifier down, with no other modifier — used for the ⌘1..9 loop. */
export function isPlainModCombo(e: KeyboardEvent): boolean {
    const secondary = isMac ? e.ctrlKey : e.metaKey;
    return isModPressed(e) && !secondary && !e.altKey && !e.shiftKey;
}

// Single-char symbol keys (?, ,, \, /) carry their shift state inside `e.key`,
// so we must NOT additionally require shiftKey to be a particular value for them.
const isSymbolKey = (key: string) => key.length === 1 && !/[a-z0-9]/i.test(key);

/** Does a keyboard event match the given binding, resolving `mod` per platform? */
export function matchesBinding(e: KeyboardEvent, id: BindingId): boolean {
    if (matchesOne(e, BINDINGS[id])) return true;
    return (ALIASES[id] ?? []).some((alias) => matchesOne(e, alias));
}

/** Match a single combo. `matchesBinding` layers the aliases on top of this. */
function matchesOne(e: KeyboardEvent, b: Binding): boolean {
    if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;

    // Primary/secondary modifier resolution.
    const secondaryDown = isMac ? e.ctrlKey : e.metaKey;
    if (b.mod) {
        if (!isModPressed(e) || secondaryDown) return false;
    } else if (b.ctrl) {
        if (!e.ctrlKey || e.metaKey) return false;
    } else {
        if (e.ctrlKey || e.metaKey) return false;
    }

    if (e.altKey !== !!b.alt) return false;

    // Shift: enforce exactly, except for symbol keys where shift is implicit.
    if (!isSymbolKey(b.key) && e.shiftKey !== !!b.shift) return false;

    return true;
}

// ── Display ────────────────────────────────────────────────────────────────

/** The label for the primary modifier on this platform. */
export const modLabel = isMac ? "⌘" : "Ctrl";

const KEY_LABELS: Record<string, string> = {
    "\\": "\\",
    ",": ",",
    "/": "/",
    "?": "?",
    ArrowLeft: "←",
    ArrowRight: "→",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Tab: "Tab",
    F11: "F11",
};

function keyLabel(key: string): string {
    if (KEY_LABELS[key]) return KEY_LABELS[key];
    return key.length === 1 ? key.toUpperCase() : key;
}

/** Render a binding for display: "⌘⇧S" on Mac, "Ctrl+Shift+S" on Win/Linux. */
export function formatBinding(b: Binding): string {
    if (isMac) {
        // macOS convention orders modifiers ⌃⌥⇧⌘, then the key.
        let out = "";
        if (b.ctrl) out += "⌃";
        if (b.alt) out += "⌥";
        if (b.shift) out += "⇧";
        if (b.mod) out += "⌘";
        return out + keyLabel(b.key);
    }
    const parts: string[] = [];
    if (b.mod || b.ctrl) parts.push("Ctrl");
    if (b.alt) parts.push("Alt");
    if (b.shift) parts.push("Shift");
    parts.push(keyLabel(b.key));
    return parts.join("+");
}

/** Display string for a registered binding, e.g. formatShortcut("saveAs"). */
export function formatShortcut(id: BindingId): string {
    return formatBinding(BINDINGS[id]);
}

/** Display strings for a binding's secondary combos, if it has any (#147). */
export function formatAliases(id: BindingId): string[] {
    return (ALIASES[id] ?? []).map(formatBinding);
}

/** Prefix an arbitrary label with the primary modifier: mod("1–8") → "⌘1–8". */
export function withMod(label: string): string {
    return isMac ? `${modLabel}${label}` : `${modLabel}+${label}`;
}

/** The AI-assist shortcut label. Alt+J on Windows (Ctrl+J is reserved by
 *  WebView2 there); ⌘J on Mac, Ctrl+J on Linux. */
export const aiShortcutLabel = isWindows ? "Alt+J" : withMod("J");

// ── CodeMirror ───────────────────────────────────────────────────────────────

const CM_KEY: Record<string, string> = {
    "\\": "\\",
    "/": "/",
};

/**
 * CodeMirror keymap string for a `mod`-based binding, e.g. toCmKey("find") →
 * "Mod-f". CodeMirror's own `Mod` already resolves to Cmd on macOS, matching
 * our `mod`. Only meaningful for editor bindings (bold/italic/link/blockquote/
 * find/replace), which are all mod-based and shift-free.
 */
export function toCmKey(id: BindingId): string {
    const b: Binding = BINDINGS[id];
    const parts: string[] = [];
    if (b.mod) parts.push("Mod");
    if (b.alt) parts.push("Alt");
    if (b.shift) parts.push("Shift");
    parts.push(CM_KEY[b.key] ?? b.key);
    return parts.join("-");
}
