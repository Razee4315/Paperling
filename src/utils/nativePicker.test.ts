import { afterEach, describe, expect, it, vi } from "vitest";
import { openSystemFilePicker, saveToDownloads } from "./nativePicker";

const w = window as unknown as {
    PaperlingAndroid?: { openDocument?: () => void; saveToDownloads?: (n: string, c: string, m: string) => void };
    __paperlingOnSaveResult?: (ok: boolean, a: string | null, b: string | null) => void;
};
afterEach(() => { delete w.PaperlingAndroid; vi.useRealTimers(); });

describe("Android document bridge (#253/#254)", () => {
    it("reports an absent or throwing picker bridge", () => {
        expect(openSystemFilePicker()).toBe(false);
        w.PaperlingAndroid = { openDocument: () => { throw new Error("Java exception"); } };
        expect(openSystemFilePicker()).toBe(false);
    });
    it("installs the save callback before calling native code", async () => {
        w.PaperlingAndroid = { saveToDownloads: (name, text, mime) => {
            expect([name, text, mime]).toEqual(["a.html", "<p>hello</p>", "text/html"]);
            w.__paperlingOnSaveResult!(true, "/cache/a.html", "a.html");
        } };
        await expect(saveToDownloads("a.html", "<p>hello</p>", "text/html"))
            .resolves.toEqual({ ok: true, path: "/cache/a.html", name: "a.html" });
        expect(w.__paperlingOnSaveResult).toBeUndefined();
    });
    it("cleans up after a synchronous Java exception and permits retry", async () => {
        w.PaperlingAndroid = { saveToDownloads: () => { throw new Error("Java exception"); } };
        expect((await saveToDownloads("a.md", "draft")).ok).toBe(false);
        expect(w.__paperlingOnSaveResult).toBeUndefined();
        w.PaperlingAndroid.saveToDownloads = () => w.__paperlingOnSaveResult!(false, "Disk full", null);
        await expect(saveToDownloads("a.md", "draft")).resolves.toEqual({ ok: false, error: "Disk full" });
    });
    it("does not let a concurrent save steal the first callback", async () => {
        w.PaperlingAndroid = { saveToDownloads: vi.fn() };
        const first = saveToDownloads("a.md", "a");
        expect((await saveToDownloads("b.md", "b")).error).toContain("already in progress");
        w.__paperlingOnSaveResult!(true, "/cache/a.md", "a.md");
        expect((await first).path).toBe("/cache/a.md");
    });
    it("cleans up an unresponsive bridge on timeout", async () => {
        vi.useFakeTimers();
        w.PaperlingAndroid = { saveToDownloads: () => {} };
        const result = saveToDownloads("a.md", "a");
        await vi.advanceTimersByTimeAsync(15000);
        expect((await result).error).toContain("timed out");
        expect(w.__paperlingOnSaveResult).toBeUndefined();
    });
});
