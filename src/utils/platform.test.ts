import { describe, it, expect } from "vitest";
import { detectMacWindow, detectMobileDevice, type MobileSignals } from "./platform";

const base: MobileSignals = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0",
    maxTouchPoints: 0,
    coarsePointer: false,
};

const signal = (over: Partial<MobileSignals>): MobileSignals => ({ ...base, ...over });

describe("detectMobileDevice", () => {
    it("detects Android, iPhone, iPod, iPad, Windows Phone UAs", () => {
        expect(detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile" }))).toBe(true);
        expect(detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1" }))).toBe(true);
        expect(detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 16_6)" }))).toBe(true);
        expect(detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5) AppleWebKit/605.1" }))).toBe(true);
        expect(detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (Windows Phone 10; Android 6.0.1) Edge/14" }))).toBe(true);
    });

    it("detects iPadOS masquerading as desktop Mac (touch + coarse pointer)", () => {
        // iPadOS 13+ reports "Macintosh" — only the touch + coarse combination gives it away.
        expect(
            detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 5, coarsePointer: true })),
        ).toBe(true);
    });

    it("never flags a real Mac, even with a touchscreen", () => {
        // Touch-screen MacBook: touch points but a fine pointer.
        expect(
            detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 5, coarsePointer: false })),
        ).toBe(false);
        expect(
            detectMobileDevice(signal({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 0, coarsePointer: true })),
        ).toBe(false);
    });

    it("never flags a desktop browser, whatever the window size", () => {
        expect(detectMobileDevice(base)).toBe(false);
        // A narrow window is still a desktop browser (fine pointer).
        expect(detectMobileDevice(signal({ maxTouchPoints: 0, coarsePointer: false }))).toBe(false);
    });

    it("never flags a Windows touchscreen PC, even when it reports a coarse pointer (PLAT-01, #206)", () => {
        // WebView2 on a 2-in-1 in (or claiming) slate posture: 10 touch points
        // and `pointer: coarse` even with a mouse attached. This used to render
        // the phone shell: no title bar, so no way to move or close the window.
        const webview2 =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
        expect(detectMobileDevice(signal({ userAgent: webview2, maxTouchPoints: 10, coarsePointer: true }))).toBe(false);
        expect(detectMobileDevice(signal({ userAgent: webview2, maxTouchPoints: 10, coarsePointer: false }))).toBe(false);
        expect(detectMobileDevice(signal({ maxTouchPoints: 5, coarsePointer: true }))).toBe(false);
    });

    it("never flags a Linux or ChromeOS touchscreen desktop (PLAT-01)", () => {
        // Tauri on Linux is WebKitGTK; ChromeOS reports X11 too.
        const webkitGtk = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
        const chromeOs = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
        expect(detectMobileDevice(signal({ userAgent: webkitGtk, maxTouchPoints: 10, coarsePointer: true }))).toBe(false);
        expect(detectMobileDevice(signal({ userAgent: chromeOs, maxTouchPoints: 10, coarsePointer: true }))).toBe(false);
    });

    it("still flags Android even though its UA also says Linux (PLAT-01)", () => {
        const androidWebView =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36";
        expect(detectMobileDevice(signal({ userAgent: androidWebView, maxTouchPoints: 5, coarsePointer: true }))).toBe(true);
        // Even with signals that look like a desktop (keyboard-dock tablet).
        expect(detectMobileDevice(signal({ userAgent: androidWebView, maxTouchPoints: 0, coarsePointer: false }))).toBe(true);
    });

    it("flags generic touch-first environments (coarse pointer + multi-touch)", () => {
        expect(
            detectMobileDevice(signal({ userAgent: "SomeWebView/1.0", maxTouchPoints: 5, coarsePointer: true })),
        ).toBe(true);
    });

    it("does not flag single-touch coarse devices (can't be trusted as phones)", () => {
        expect(
            detectMobileDevice(signal({ userAgent: "KioskBrowser/1.0", maxTouchPoints: 1, coarsePointer: true })),
        ).toBe(false);
    });

    it("treats an empty UA defensively (falls through to pointer checks)", () => {
        expect(detectMobileDevice(signal({ userAgent: "", maxTouchPoints: 0, coarsePointer: false }))).toBe(false);
        expect(detectMobileDevice(signal({ userAgent: "", maxTouchPoints: 5, coarsePointer: true }))).toBe(true);
    });
});

describe("detectMacWindow (CHROME-05)", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

    it("is the desktop app on a Mac", () => {
        expect(detectMacWindow({ tauri: true, mobile: false, userAgent: mac })).toBe(true);
    });

    it("is not a browser on a Mac: there the page has no window of its own", () => {
        expect(detectMacWindow({ tauri: false, mobile: false, userAgent: mac })).toBe(false);
    });

    it("is not an iPad, which also says Macintosh but runs the phone shell", () => {
        expect(detectMacWindow({ tauri: true, mobile: true, userAgent: mac })).toBe(false);
    });

    it("is not Windows or Linux, where the window stays frameless", () => {
        expect(detectMacWindow({ tauri: true, mobile: false, userAgent: base.userAgent })).toBe(false);
        expect(detectMacWindow({ tauri: true, mobile: false, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15" })).toBe(false);
        expect(detectMacWindow({ tauri: true, mobile: false, userAgent: "" })).toBe(false);
    });
});
