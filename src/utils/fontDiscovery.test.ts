import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getInstalledFontFamilies,
    resetFontDiscoveryCache,
    candidateFontFamilies,
} from "./fontDiscovery";

describe("fontDiscovery (SET-03)", () => {
    beforeEach(() => {
        resetFontDiscoveryCache();
        vi.restoreAllMocks();
    });

    it("exposes a curated candidate list that includes the bundled fonts", () => {
        const candidates = candidateFontFamilies();
        expect(candidates).toContain("Inter");
        expect(candidates).toContain("Segoe UI");
        expect(candidates).toContain("Helvetica Neue");
        expect(candidates.length).toBeGreaterThan(80);
    });

    it("uses queryLocalFonts when available and permitted, sorted + deduped", async () => {
        const queryLocalFonts = vi.fn().mockResolvedValue([
            { family: "Zapfino" },
            { family: "Arial" },
            { family: "Arial" }, // duplicate family entry
            { family: "Inter" },
        ]);
        (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts = queryLocalFonts;
        const fonts = await getInstalledFontFamilies();
        expect(fonts).toEqual(["Arial", "Inter", "Zapfino"]);
    });

    it("falls back to probing when the API is missing (returns a usable list)", async () => {
        delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
        const fonts = await getInstalledFontFamilies();
        // In jsdom nothing measures differently, so the probe finds nothing —
        // but it must still resolve (empty list is fine) and never throw.
        expect(Array.isArray(fonts)).toBe(true);
    });

    it("falls back to probing when the API rejects (permission denied)", async () => {
        (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts =
            vi.fn().mockRejectedValue(new Error("denied"));
        const fonts = await getInstalledFontFamilies();
        expect(Array.isArray(fonts)).toBe(true);
    });

    it("caches: the second call does not re-enumerate", async () => {
        const queryLocalFonts = vi.fn().mockResolvedValue([{ family: "Arial" }]);
        (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts = queryLocalFonts;
        await getInstalledFontFamilies();
        await getInstalledFontFamilies();
        expect(queryLocalFonts).toHaveBeenCalledTimes(1);
    });
});
