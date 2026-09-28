import { Window } from "@tauri-apps/api/window";

/**
 * The current Tauri window, or null outside a Tauri webview (plain browser
 * dev). `Window.getCurrent()` reads `window.__TAURI_INTERNALS__.metadata`
 * eagerly, so in a plain browser it THROWS synchronously — every window-API
 * call site must go through this guard instead of calling getCurrent()
 * directly, or a browser dev session dies at boot.
 */
export function desktopWindow(): Window | null {
    try {
        if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
        return Window.getCurrent();
    } catch {
        return null;
    }
}

/**
 * Reveal the main window, which is created hidden (`visible: false` in
 * tauri.conf.json) to kill the white startup flash: the webview would otherwise
 * paint an empty white surface before the themed UI loaded, which is jarring on
 * the dark theme. We keep it hidden until the React tree has mounted and painted
 * the correct background, then show it here.
 *
 * Idempotent: calling it more than once is harmless, so several call sites (the
 * normal mount effect, a crash fallback, and a failsafe timeout) can all invoke
 * it without coordination. A no-op in browser dev mode (no Tauri window).
 */
export async function revealMainWindow(): Promise<void> {
    try {
        const win = desktopWindow();
        if (!win) return;
        await win.show();
        await win.setFocus();
    } catch (err) {
        // An ACL denial once shipped builds whose window could NEVER be shown
        // (show/set-focus missing from capabilities). Log it: a silent failure
        // here means an invisible app.
        console.error("revealMainWindow failed:", err);
    }
}
