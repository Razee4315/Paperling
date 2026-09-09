/**
 * localStorage-backed persistence for app state across sessions.
 * Tauri's webview has localStorage available; values survive app restarts.
 */

import { sanitizeSessions, pruneSessions, type ChatSession } from "./chatSessions";
// Boot-time shell decision — used only to pick sensible DEFAULTS for
// touch-first users (e.g. the formatting toolbar ships on, because a phone
// has no Ctrl+B). Explicit stored choices always win over these defaults.
import { IS_MOBILE } from "./platform";

// One-time migration from the app's pre-rename key prefix. The bundle
// identifier (and therefore the WebView2 storage location) is unchanged, so
// existing users still have their old "marklite:*" entries — copy each to its
// "paperling:*" name once, then drop the original. Runs at module load,
// before any getter seeds React state. Exported for tests.
export function migrateLegacyKeys(): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith("marklite:")) continue;
            const renamed = "paperling:" + key.slice("marklite:".length);
            const value = localStorage.getItem(key);
            if (value !== null && localStorage.getItem(renamed) === null) {
                localStorage.setItem(renamed, value);
            }
            localStorage.removeItem(key);
        }
    } catch { /* storage unavailable — nothing to migrate */ }
}
migrateLegacyKeys();

const KEY_RECENT_FILES = "paperling:recentFiles";
const KEY_LAST_FILE = "paperling:lastFile";
const KEY_VIEW_MODE = "paperling:viewMode";
const KEY_SPLIT_RATIO = "paperling:splitRatio";

// Multi-file/tab workflows make 10 feel tight; 25 keeps the palette's recents
// useful without unbounded growth.
const MAX_RECENT = 25;

const safeGet = <T>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
};

const safeSet = (key: string, value: unknown): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {/* storage may be full / disabled */}
};

export interface RecentFile {
    path: string;
    name: string;
    openedAt: number;
}

export const getRecentFiles = (): RecentFile[] => safeGet<RecentFile[]>(KEY_RECENT_FILES, []);

export const addRecentFile = (path: string, name: string): RecentFile[] => {
    const list = getRecentFiles().filter((f) => f.path !== path);
    list.unshift({ path, name, openedAt: Date.now() });
    const trimmed = list.slice(0, MAX_RECENT);
    safeSet(KEY_RECENT_FILES, trimmed);
    return trimmed;
};

export const removeRecentFile = (path: string): RecentFile[] => {
    const list = getRecentFiles().filter((f) => f.path !== path);
    safeSet(KEY_RECENT_FILES, list);
    return list;
};

export const clearRecentFiles = (): void => safeSet(KEY_RECENT_FILES, []);

export const getLastFile = (): string | null => safeGet<string | null>(KEY_LAST_FILE, null);
export const setLastFile = (path: string | null): void => safeSet(KEY_LAST_FILE, path);

// Full multi-tab session, so a relaunch reopens every tab the user had — not
// just the single last file. Only files with a path are stored (untitled
// buffers have no content persisted here); `activeIndex` points into `tabs`.
// getLastFile stays as a migration fallback for sessions saved before this. TABS-07.
const KEY_SESSION = "paperling:session";
export interface SessionTab {
    path: string;
    /** 1-based caret/scroll line to restore. */
    cursorLine?: number;
}
export interface SessionState {
    tabs: SessionTab[];
    activeIndex: number;
}
export const getSession = (): SessionState | null => {
    const s = safeGet<SessionState | null>(KEY_SESSION, null);
    if (!s || !Array.isArray(s.tabs)) return null;
    // Defend against a malformed/hand-edited value.
    const tabs = s.tabs.filter((t): t is SessionTab => !!t && typeof t.path === "string");
    if (tabs.length === 0) return null;
    const activeIndex = Number.isInteger(s.activeIndex) ? Math.min(Math.max(0, s.activeIndex), tabs.length - 1) : 0;
    return { tabs, activeIndex };
};
export const setSession = (s: SessionState | null): void => safeSet(KEY_SESSION, s);

export const getSavedViewMode = (): "preview" | "code" | "split" =>
    safeGet<"preview" | "code" | "split">(KEY_VIEW_MODE, "preview");
export const setSavedViewMode = (m: "preview" | "code" | "split"): void => safeSet(KEY_VIEW_MODE, m);

export const getSplitRatio = (): number => {
    const r = safeGet<number>(KEY_SPLIT_RATIO, 0.5);
    return Number.isFinite(r) && r > 0.15 && r < 0.85 ? r : 0.5;
};
export const setSplitRatio = (r: number): void => safeSet(KEY_SPLIT_RATIO, r);

const KEY_TOUR_DONE = "paperling:tourDone";
export const getTourDone = (): boolean => safeGet<boolean>(KEY_TOUR_DONE, false);
export const setTourDone = (v: boolean): void => safeSet(KEY_TOUR_DONE, v);

const KEY_TYPEWRITER_MODE = "paperling:typewriterMode";
const KEY_TOOLBAR = "paperling:toolbar";
const KEY_WORD_WRAP = "paperling:wordWrap";
const KEY_SPELL_CHECK = "paperling:spellCheck";
export const getTypewriterMode = (): boolean => safeGet<boolean>(KEY_TYPEWRITER_MODE, false);
export const setTypewriterMode = (v: boolean): void => safeSet(KEY_TYPEWRITER_MODE, v);
// Default ON on mobile: the toolbar is the only formatting entry point a
// touch user has (no Ctrl+B/I/K). Desktop keeps its opt-in default.
export const getToolbarEnabled = (): boolean => safeGet<boolean>(KEY_TOOLBAR, IS_MOBILE);
export const setToolbarEnabled = (v: boolean): void => safeSet(KEY_TOOLBAR, v);
export const getWordWrap = (): boolean => safeGet<boolean>(KEY_WORD_WRAP, true);
export const setWordWrap = (v: boolean): void => safeSet(KEY_WORD_WRAP, v);
export const getSpellCheck = (): boolean => safeGet<boolean>(KEY_SPELL_CHECK, false);
export const setSpellCheck = (v: boolean): void => safeSet(KEY_SPELL_CHECK, v);

const KEY_AUTO_SAVE = "paperling:autoSave";
export const getAutoSave = (): boolean => safeGet<boolean>(KEY_AUTO_SAVE, false);
export const setAutoSave = (v: boolean): void => safeSet(KEY_AUTO_SAVE, v);

// "Always open files in reader": every file open switches to preview mode,
// for the read-mostly audience. New files still open in code mode, and the
// flag is read live at each open (no cached state to keep in sync). READ-01.
const KEY_OPEN_IN_READER = "paperling:openInReader";
export const getOpenInReader = (): boolean => safeGet<boolean>(KEY_OPEN_IN_READER, false);
export const setOpenInReader = (v: boolean): void => safeSet(KEY_OPEN_IN_READER, v);

// Zen mode: distraction-free reading canvas. Hides the title bar, tab bar,
// mode toggle, status bar, and all side panels, leaving only the rendered
// markdown. Toggled via F9, the command palette, or Settings → Editor; the
// flag persists so read-mostly users stay in zen across restarts. ZEN-01.
const KEY_ZEN_MODE = "paperling:zenMode";
export const getZenMode = (): boolean => safeGet<boolean>(KEY_ZEN_MODE, false);
export const setZenMode = (v: boolean): void => safeSet(KEY_ZEN_MODE, v);

// Master switch for every AI surface (title-bar button, side panel, toolbar
// sparkle, Alt+J, command palette entry). OFF by default — AI needs an
// endpoint the user has to configure anyway, and an enabled-by-default
// feature that can't work yet is just noise in the UI (owner request).
const KEY_AI_ENABLED = "paperling:aiEnabled";
export const getAIEnabled = (): boolean => safeGet<boolean>(KEY_AI_ENABLED, false);
export const setAIEnabled = (v: boolean): void => safeSet(KEY_AI_ENABLED, v);

// How many previous chat turns (user + assistant pairs) accompany each AI
// panel request. Read live per send; clamped so a hand-edited value can't
// balloon requests. 0 = every message starts fresh. Issue #111.
const KEY_AI_HISTORY_TURNS = "paperling:aiHistoryTurns";
export const AI_HISTORY_TURNS_DEFAULT = 8;
export const AI_HISTORY_TURNS_MAX = 50;
export const getAIHistoryTurns = (): number => {
    const v = safeGet<number>(KEY_AI_HISTORY_TURNS, AI_HISTORY_TURNS_DEFAULT);
    if (typeof v !== "number" || !Number.isFinite(v)) return AI_HISTORY_TURNS_DEFAULT;
    return Math.min(AI_HISTORY_TURNS_MAX, Math.max(0, Math.round(v)));
};
export const setAIHistoryTurns = (v: number): void =>
    safeSet(KEY_AI_HISTORY_TURNS, Math.min(AI_HISTORY_TURNS_MAX, Math.max(0, Math.round(v))));

// Width of the AI side panel in px, set by dragging its left edge. Issue #111.
// Clamped on both read and write: the editor reserves this much padding, so a
// hand-edited or stale value must never be able to squeeze the document to
// nothing or push the panel off screen. The upper bound is also capped against
// the viewport at render time (the panel keeps a max-w of 90vw).
const KEY_AI_PANEL_WIDTH = "paperling:aiPanelWidth";
export const AI_PANEL_WIDTH_DEFAULT = 400;
export const AI_PANEL_WIDTH_MIN = 280;
export const AI_PANEL_WIDTH_MAX = 900;
const clampPanelWidth = (v: number): number =>
    Math.min(AI_PANEL_WIDTH_MAX, Math.max(AI_PANEL_WIDTH_MIN, Math.round(v)));
export const getAIPanelWidth = (): number => {
    const v = safeGet<number>(KEY_AI_PANEL_WIDTH, AI_PANEL_WIDTH_DEFAULT);
    if (typeof v !== "number" || !Number.isFinite(v)) return AI_PANEL_WIDTH_DEFAULT;
    return clampPanelWidth(v);
};
export const setAIPanelWidth = (v: number): void => safeSet(KEY_AI_PANEL_WIDTH, clampPanelWidth(v));

// The title-bar AI button's shimmering icon. On by default (unchanged look);
// off renders it as plain text, which some users simply prefer. Issue #111.
const KEY_AI_ICON_ANIMATION = "paperling:aiIconAnimation";
export const getAIIconAnimation = (): boolean => safeGet<boolean>(KEY_AI_ICON_ANIMATION, true);
export const setAIIconAnimation = (v: boolean): void => safeSet(KEY_AI_ICON_ANIMATION, v);

// Stored AI chat sessions, so closing the panel or starting a new chat no longer
// throws the conversation away. Reads go through sanitizeSessions so a corrupted
// entry degrades to "no history" instead of breaking the panel; writes prune to
// the count and size caps. Issue #111.
const KEY_AI_CHAT_SESSIONS = "paperling:aiChatSessions";
export const getChatSessions = (): ChatSession[] =>
    sanitizeSessions(safeGet<unknown>(KEY_AI_CHAT_SESSIONS, []));
export const setChatSessions = (sessions: readonly ChatSession[]): void =>
    safeSet(KEY_AI_CHAT_SESSIONS, pruneSessions(sessions));

// Version the user chose to skip in the update popup, so we don't nag about
// it on every launch. A newer release has a different version string and
// prompts again.
const KEY_SKIPPED_UPDATE = "paperling:skippedUpdateVersion";
export const getSkippedUpdateVersion = (): string | null =>
    safeGet<string | null>(KEY_SKIPPED_UPDATE, null);
export const setSkippedUpdateVersion = (v: string): void => safeSet(KEY_SKIPPED_UPDATE, v);

const KEY_AI_ENDPOINT = "paperling:aiEndpoint";
const KEY_AI_MODEL = "paperling:aiModel";
const KEY_AI_API_KEY = "paperling:aiApiKey";

// AI API key now lives in the OS keychain (SECURITY-01), accessed via the
// get_ai_key / set_ai_key Tauri commands. To keep getAIConfig() synchronous (it
// seeds React useState initializers), the key is mirrored into a module cache
// that initAIKey() hydrates once at startup. A localStorage fallback covers
// environments without a keychain (e.g. a headless Linux box) so AI never
// silently breaks.
let cachedAIKey = "";
let aiKeyLoaded = false;

export async function initAIKey(): Promise<void> {
    if (aiKeyLoaded) return;
    aiKeyLoaded = true;
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        cachedAIKey = await invoke<string>("get_ai_key");
        // One-time migration: move any legacy plaintext key into the keychain.
        if (!cachedAIKey) {
            const legacy = safeGet<string>(KEY_AI_API_KEY, "");
            if (legacy) {
                cachedAIKey = legacy;
                try {
                    await invoke("set_ai_key", { key: legacy });
                    localStorage.removeItem(KEY_AI_API_KEY);
                } catch {/* keychain unavailable — leave the localStorage copy */}
            }
        }
    } catch {
        // No keychain available — fall back to the legacy localStorage value.
        cachedAIKey = safeGet<string>(KEY_AI_API_KEY, "");
    }
}

export const getAIConfig = (): { endpoint: string; model: string; apiKey: string } => ({
    endpoint: safeGet<string>(KEY_AI_ENDPOINT, ""),
    model: safeGet<string>(KEY_AI_MODEL, ""),
    // Prefer the hydrated keychain value; fall back to a (legacy) localStorage
    // key before initAIKey() has resolved or when no keychain is present.
    apiKey: cachedAIKey || safeGet<string>(KEY_AI_API_KEY, ""),
});

export const setAIConfig = (cfg: { endpoint: string; model: string; apiKey: string }): void => {
    safeSet(KEY_AI_ENDPOINT, cfg.endpoint);
    safeSet(KEY_AI_MODEL, cfg.model);
    cachedAIKey = cfg.apiKey;
    // Persist the key to the OS keychain (desktop) or the app-private key
    // file (mobile). If that fails we deliberately do NOT fall back to
    // localStorage: a cleartext secret on disk outlives the session and
    // survives even a later keychain cleanup. The key stays in memory for
    // this session; the failure is logged so "it didn't save" is visible.
    // (The one-time legacy MIGRATION read in initAIKey is unaffected — it
    // moves an existing plaintext key into secure storage and deletes it.)
    import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("set_ai_key", { key: cfg.apiKey }))
        .then(() => { try { localStorage.removeItem(KEY_AI_API_KEY); } catch {/* ignore */} })
        .catch((err) => console.error("Could not securely persist the AI API key:", err));
};
