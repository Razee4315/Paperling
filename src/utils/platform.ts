/**
 * One boot-time decision about which shell to render, plus the "am I in
 * Tauri" fact. Per the mobile-port architecture rule, mobile is decided ONCE
 * here (at module load / boot) and exposed as a class on `<html>`; styling is
 * driven through CSS and JS reads the resolved constant — there is no
 * `useIsMobile()` hook, so a resize never flips the whole app's shape.
 *
 * Three different facts live here and must not be conflated:
 *   1. `isTauri()`        — running inside a Tauri webview (invoke available).
 *   2. `IS_MOBILE`        — render the phone shell (touch, no window chrome).
 *   3. everything else    — desktop Tauri or desktop browser.
 *
 * Mobile is detected by user agent + a coarse/limited pointer, NOT by width:
 * a 400 px browser window on a laptop still has a mouse and hover, and
 * dragging that user into a thumb-first shell is worse than leaving it
 * narrow. A desktop OS in the user agent always wins over the pointer
 * signals (PLAT-01). `?mobile=1` / `?mobile=0` in the URL overrides the
 * decision for testing the phone shell from a desktop browser.
 */

/** True inside any Tauri webview (desktop or mobile). */
export function isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface MobileSignals {
    userAgent: string;
    maxTouchPoints: number;
    coarsePointer: boolean;
    /** Standalone display-mode check (installed PWA-ish); part of the iPad puzzle. */
    standalone?: boolean;
}

/**
 * Pure decision function: does this environment present as a phone/tablet?
 * - `Android`/`iPhone`/`iPod` in the UA is definitive.
 * - iPadOS 13+ masquerades as desktop Safari, hence the (mac + touch + no
 *   fine pointer) branch — a Mac laptop has `maxTouchPoints === 0` or a fine
 *   pointer, so it never trips.
 * - A Windows or Linux desktop UA is definitive the other way (PLAT-01).
 * - `maxTouchPoints > 1` alone is not enough (touch laptops), so the coarse
 *   pointer media query is the tiebreaker for anything else.
 */
export function detectMobileDevice(s: MobileSignals): boolean {
    const ua = s.userAgent || "";
    if (/android|iphone|ipod|windows phone/i.test(ua)) return true;
    if (/ipad/i.test(ua)) return true;
    // iPadOS pretends to be "Macintosh" — but it has 5 touch points and no hover.
    if (/macintosh/i.test(ua) && s.maxTouchPoints > 1 && s.coarsePointer) return true;
    // PLAT-01 (#206): Chromium/WebView2 on Windows reports `pointer: coarse`
    // for any touchscreen PC it believes is used as a tablet (touch + rotation
    // sensor + slate posture), and then ignores a connected mouse entirely.
    // Many 2-in-1s claim slate posture with the keyboard attached, so the
    // generic fallback below put the desktop app into the phone shell: no
    // title bar, so no way to move, maximize or close the frameless window,
    // plus the phone open/save flows. The desktop app has no phone build, and
    // Android/Windows Phone UAs already returned above, so any remaining
    // Windows or Linux (X11, WebKitGTK, ChromeOS) UA is a desktop, touch or not.
    if (/windows nt|x11|linux/i.test(ua)) return false;
    // Generic touch-first fallback (Android Go devices, unusual WebViews).
    return s.maxTouchPoints > 1 && s.coarsePointer;
}

function queryOverride(): boolean | null {
    try {
        const value = new URLSearchParams(window.location.search).get("mobile");
        if (value === "1" || value === "true") return true;
        if (value === "0" || value === "false") return false;
    } catch {
        /* parse failure just means "no override" */
    }
    return null;
}

function collectSignals(): MobileSignals {
    return {
        userAgent: navigator.userAgent || "",
        maxTouchPoints: navigator.maxTouchPoints || 0,
        coarsePointer: typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
        standalone: typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches,
    };
}

function computeIsMobile(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const override = queryOverride();
    if (override !== null) return override;
    return detectMobileDevice(collectSignals());
}

/**
 * The boot-time verdict. Resolved exactly once at module load; treated as
 * immutable for the life of the webview (a rotation or window drag across
 * monitors must never reshape the app mid-session).
 */
export const IS_MOBILE: boolean = computeIsMobile();

/**
 * Pure decision: is this the desktop app on a Mac? There the window is a
 * native one (`tauri.macos.conf.json`): macOS draws the red/yellow/green
 * buttons over the left end of our title bar and owns fullscreen, so the app
 * must not draw window buttons of its own and its bars leave room for the
 * system's. iPadOS also says "Macintosh", which is why the phone-shell verdict
 * is an input. CHROME-05 (#262).
 */
export function detectMacWindow(s: { tauri: boolean; mobile: boolean; userAgent: string }): boolean {
    return s.tauri && !s.mobile && /macintosh|mac os x/i.test(s.userAgent || "");
}

function macWindowOverride(): boolean | null {
    try {
        const value = new URLSearchParams(window.location.search).get("macwindow");
        if (value === "1" || value === "true") return true;
        if (value === "0" || value === "false") return false;
    } catch {
        /* parse failure just means "no override" */
    }
    return null;
}

/**
 * Boot-time verdict, immutable like `IS_MOBILE`. `?macwindow=1` shows the Mac
 * layout (no window buttons, room for the traffic lights) in a desktop browser,
 * the same way `?mobile=1` shows the phone shell.
 */
export const MAC_WINDOW: boolean =
    typeof window !== "undefined" && typeof navigator !== "undefined"
        ? (macWindowOverride() ?? detectMacWindow({ tauri: isTauri(), mobile: IS_MOBILE, userAgent: navigator.userAgent }))
        : false;

/**
 * Width the bars keep clear at their left for the traffic lights: the buttons
 * end 77px in (17px inset, three 14px buttons 23px apart; see
 * `trafficLightPosition` in tauri.macos.conf.json), plus a little air.
 */
export const MAC_LIGHTS_INSET = 86;

/** Coarse-pointer touch device (drives hover-reveal fixes); computed once. */
export const IS_TOUCH: boolean =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

/**
 * Adds the resolved shell classes to `<html>` so CSS can restyle everything
 * downstream. `mobile` = the phone shell; `touch` = coarse-pointer device
 * (drives the `touch:` Tailwind variant used to make hover-revealed controls
 * permanently visible). Called once from main.tsx before the first render.
 * Returns the classes it applied (also convenient for tests).
 */
export function initPlatformClass(target: Document = document): string[] {
    const classes: string[] = [];
    const root = target.documentElement;
    if (IS_MOBILE) classes.push("mobile");
    try {
        if (typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
            classes.push("touch");
        }
        // A forced `?mobile=1` on a desktop browser must still get touch
        // behavior, otherwise the phone shell renders with hover-only controls.
        if (!classes.includes("touch") && queryOverride() === true) classes.push("touch");
    } catch {
        /* matchMedia unavailable — mobile class alone still works */
    }
    if (classes.length) root.classList.add(...classes);
    return classes;
}
