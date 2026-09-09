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
    saveToDownloads?: (name: string, content: string, mime?: string) => void;
}

function getBridge(): PaperlingBridge | undefined {
    return (window as unknown as { PaperlingAndroid?: PaperlingBridge }).PaperlingAndroid;
}

export function openSystemFilePicker(): boolean {
    const bridge = getBridge();
    if (!bridge?.openDocument) return false;
    bridge.openDocument();
    return true;
}

/**
 * Sentinel a save-location prompt resolves with when the user picked the
 * Downloads destination in the Save-As modal. The prompt's type contract
 * (string | null) is unchanged; the save call sites check for this value and
 * perform the native write themselves (they own the note content), then treat
 * the returned cache path like any other save path.
 */
export const DOWNLOADS_SENTINEL = "__paperling:downloads";

export interface DownloadsSaveResult {
    ok: boolean;
    /** App-cache mirror of the Downloads file; a real path the app can use. */
    path?: string;
    /** The name MediaStore actually used (duplicates get " (1)" suffixes). */
    name?: string;
    error?: string;
}

/** Resolves the Kotlin side's one-shot __paperlingOnSaveResult callback. */
function waitSaveResult(): Promise<DownloadsSaveResult> {
    return new Promise((resolve) => {
        const w = window as unknown as {
            __paperlingOnSaveResult?: (ok: boolean, a: string | null, b: string | null) => void;
        };
        const timer = window.setTimeout(() => {
            w.__paperlingOnSaveResult = undefined;
            resolve({ ok: false, error: "Saving to Downloads timed out" });
        }, 15_000);
        w.__paperlingOnSaveResult = (ok, a, b) => {
            window.clearTimeout(timer);
            w.__paperlingOnSaveResult = undefined;
            resolve(ok ? { ok: true, path: a ?? undefined, name: b ?? undefined } : { ok: false, error: a ?? "Save failed" });
        };
    });
}

export async function saveToDownloads(
    name: string,
    content: string,
    mime: string = "text/markdown",
): Promise<DownloadsSaveResult> {
    const bridge = getBridge();
    if (!bridge?.saveToDownloads) return { ok: false, error: "not-available" };
    bridge.saveToDownloads(name, content, mime);
    return waitSaveResult();
}

export function downloadsSaveAvailable(): boolean {
    return !!getBridge()?.saveToDownloads;
}
