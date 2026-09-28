import { describe, it, expect } from "vitest";
import { detectMobileDevice, type MobileSignals } from "./platform";

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
