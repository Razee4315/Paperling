/**
 * One-call handles to the Android native bridges (patched MainActivity).
 *
 * openSystemFilePicker: the in-app file browser can only see folders the Rust
 * file commands can read — on Android that's effectively the app-private
 * notes root. Opening a .md from anywhere (Downloads, Drive, SD card) needs
 * ACTION_OPEN_DOCUMENT, which lives on the native side: the bridge launches
 * the picker, copies the picked content:// file into the app cache, and hands
 * the real path to the webview through window.__paperlingOpenFile (the same
 * bridge "Open with" intents use).
 *
 * saveToDownloads: writes a note into the user-visible Downloads folder via
 * MediaStore (no storage permission needed for the app's own inserts) and
 * mirrors it into the app cache, returning the cache path so the save flow
 * can treat it like any other save destination.
 *
 * Both return false / reject when the native bridge isn't there (old build /
 * browser dev / ?mobile=1 on desktop), so callers can show a guiding message
 * instead of no-op'ing silently.
 */

interface PaperlingBridge {
    openDocument?: () => void;
    /** mime is optional and defaults to text/markdown on the native side
        (HTML export passes "text/html" so Downloads opens it in a browser). */
    saveToDownloads?: (name: string, content: string, mime: string, requestId: string) => void;
    /** Writes edits from a cache working copy back to its original content:// URI (ANDR-02). */
    syncToSource?: (cachePath: string, content: string, requestId: string) => void;
}

function getBridge(): PaperlingBridge | undefined {
    return (window as unknown as { PaperlingAndroid?: PaperlingBridge }).PaperlingAndroid;
}

export function openSystemFilePicker(): boolean {
    const bridge = getBridge();
    if (!bridge?.openDocument) return false;
    try {
        bridge.openDocument();
        return true;
    } catch {
        return false;
    }
}

/**
 * Sentinel a save-location prompt resolves with when the user picked the
 * Downloads destination in the Save-As modal. The prompt's type contract
 * (string | null) is unchanged; the save call sites check for this value and
 * perform the native write themselves (they own the note content), then treat
 * the returned cache path like any other save path.
 */
export const DOWNLOADS_SENTINEL = "__paperling:downloads";

export function makeDownloadsSentinel(name: string): string {
    return `${DOWNLOADS_SENTINEL}:${name}`;
}

export function parseDownloadsSentinel(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value === DOWNLOADS_SENTINEL) return "";
    if (value.startsWith(`${DOWNLOADS_SENTINEL}:`)) return value.slice(DOWNLOADS_SENTINEL.length + 1);
    return null;
}

export interface DownloadsSaveResult {
    ok: boolean;
    /** App-cache mirror of the Downloads file; a real path the app can use. */
    path?: string;
    /** The name MediaStore actually used (duplicates get " (1)" suffixes). */
    name?: string;
    error?: string;
}

/** Resolves the Kotlin side's one-shot __paperlingOnSaveResult callback. */
let savePending = false;
let nextSaveId = 0;
function waitSaveResult(requestId: string, start: () => void): Promise<DownloadsSaveResult> {
    return new Promise((resolve) => {
        const w = window as unknown as {
            __paperlingOnSaveResult?: (ok: boolean, a: string | null, b: string | null, requestId: string) => void;
        };
        let finished = false;
        const finish = (result: DownloadsSaveResult) => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timer);
            w.__paperlingOnSaveResult = undefined;
            savePending = false;
            resolve(result);
        };
        const timer = window.setTimeout(() => finish({ ok: false, error: "Saving to Downloads timed out" }), 15_000);
        w.__paperlingOnSaveResult = (ok, a, b, resultId) => {
            // SAF-03: a slow result after timeout must never acknowledge a
            // newer save (which would mark a different note as saved).
            if (resultId !== requestId) return;
            finish(ok ? { ok: true, path: a ?? undefined, name: b ?? undefined } : { ok: false, error: a ?? "Save failed" });
        };
        // SAF-02: install the callback BEFORE invoking native code, and clean
        // it up on synchronous Java errors. A second save cannot steal it.
        try { start(); } catch {
            finish({ ok: false, error: "Could not start saving to Downloads. Try again or restart Paperling." });
        }
    });
}

export async function saveToDownloads(
    name: string,
    content: string,
    mime: string = "text/markdown",
): Promise<DownloadsSaveResult> {
    const bridge = getBridge();
    if (!bridge?.saveToDownloads) return { ok: false, error: "not-available" };
    if (savePending) return { ok: false, error: "A Downloads save is already in progress" };
    savePending = true;
    const requestId = `${Date.now()}-${++nextSaveId}`;
    return waitSaveResult(requestId, () => bridge.saveToDownloads!(name, content, mime, requestId));
}

export function downloadsSaveAvailable(): boolean {
    return !!getBridge()?.saveToDownloads;
}

export interface SyncSourceResult {
    ok: boolean;
    error?: string;
}

/**
 * True when `path` is an Android imported/Downloads working copy inside
 * `<cacheDir>/open/<hash>/<name>` rather than a note in the app-private
 * notes folder. ANDR-02 (#305).
 */
export function isAndroidCachePath(path: string): boolean {
    return /\/cache\/open\/[^/]+\//.test(path.replace(/\\/g, "/"));
}

export function syncToSourceAvailable(): boolean {
    return !!getBridge()?.syncToSource;
}

const pendingSyncs = new Map<string, (result: SyncSourceResult) => void>();
let nextSyncId = 0;

/**
 * Write `content` back to the original Android content:// URI associated with
 * `cachePath`. Keyed by `requestId` in a map so concurrent active + background
 * tab autosaves can settle out of order safely. ANDR-02 (#305).
 */
export async function syncToSource(cachePath: string, content: string): Promise<SyncSourceResult> {
    const bridge = getBridge();
    if (!bridge?.syncToSource) return { ok: false, error: "not-available" };
    const requestId = `${Date.now()}-${++nextSyncId}`;
    return new Promise((resolve) => {
        const w = window as unknown as {
            __paperlingOnSyncResult?: (ok: boolean, error: string | null, requestId: string) => void;
        };
        const finish = (result: SyncSourceResult) => {
            const waiter = pendingSyncs.get(requestId);
            if (!waiter) return;
            pendingSyncs.delete(requestId);
            window.clearTimeout(timer);
            if (pendingSyncs.size === 0) w.__paperlingOnSyncResult = undefined;
            resolve(result);
        };
        const timer = window.setTimeout(
            () => finish({ ok: false, error: "Saving back to the original file timed out" }),
            15_000,
        );
        pendingSyncs.set(requestId, finish);
        w.__paperlingOnSyncResult = (ok, error, resultId) => {
            const target = pendingSyncs.get(resultId);
            if (!target) return;
            target(ok ? { ok: true } : { ok: false, error: error ?? "Could not save back to the original file" });
        };
        try {
            bridge.syncToSource!(cachePath, content, requestId);
        } catch {
            finish({ ok: false, error: "Could not start saving back to the original file." });
        }
    });
}
