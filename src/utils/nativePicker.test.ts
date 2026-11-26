import { afterEach, describe, expect, it, vi } from "vitest";
import { isAndroidCachePath, makeDownloadsSentinel, openSystemFilePicker, parseDownloadsSentinel, saveToDownloads, syncToSource } from "./nativePicker";

const w = window as unknown as {
    PaperlingAndroid?: {
        openDocument?: () => void;
        saveToDownloads?: (n: string, c: string, m: string, id: string) => void;
        syncToSource?: (p: string, c: string, id: string) => void;
    };
    __paperlingOnSaveResult?: (ok: boolean, a: string | null, b: string | null, id: string) => void;
    __paperlingOnSyncResult?: (ok: boolean, error: string | null, id: string) => void;
};
afterEach(() => { delete w.PaperlingAndroid; delete w.__paperlingOnSyncResult; vi.useRealTimers(); });

describe("Android document bridge (#253/#254)", () => {
    it("reports an absent or throwing picker bridge", () => {
        expect(openSystemFilePicker()).toBe(false);
        w.PaperlingAndroid = { openDocument: () => { throw new Error("Java exception"); } };
        expect(openSystemFilePicker()).toBe(false);
    });
    it("installs the save callback before calling native code", async () => {
        w.PaperlingAndroid = { saveToDownloads: (name, text, mime, id) => {
            expect([name, text, mime]).toEqual(["a.html", "<p>hello</p>", "text/html"]);
            w.__paperlingOnSaveResult!(true, "/cache/a.html", "a.html", id);
        } };
        await expect(saveToDownloads("a.html", "<p>hello</p>", "text/html"))
            .resolves.toEqual({ ok: true, path: "/cache/a.html", name: "a.html" });
        expect(w.__paperlingOnSaveResult).toBeUndefined();
    });
    it("cleans up after a synchronous Java exception and permits retry", async () => {
        w.PaperlingAndroid = { saveToDownloads: () => { throw new Error("Java exception"); } };
        expect((await saveToDownloads("a.md", "draft")).ok).toBe(false);
        expect(w.__paperlingOnSaveResult).toBeUndefined();
        w.PaperlingAndroid.saveToDownloads = (_n, _c, _m, id) => w.__paperlingOnSaveResult!(false, "Disk full", null, id);
        await expect(saveToDownloads("a.md", "draft")).resolves.toEqual({ ok: false, error: "Disk full" });
    });
    it("does not let a concurrent save steal the first callback", async () => {
        const native = vi.fn();
        w.PaperlingAndroid = { saveToDownloads: native };
        const first = saveToDownloads("a.md", "a");
        expect((await saveToDownloads("b.md", "b")).error).toContain("already in progress");
        w.__paperlingOnSaveResult!(true, "/cache/a.md", "a.md", native.mock.calls[0][3]);
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
    it("ignores late results after timeout instead of acknowledging another note's save", async () => {
        vi.useFakeTimers();
        const native = vi.fn();
        w.PaperlingAndroid = { saveToDownloads: native };
        const old = saveToDownloads("old.md", "old");
        await vi.advanceTimersByTimeAsync(15000);
        await old;
        const current = saveToDownloads("current.md", "new work");
        w.__paperlingOnSaveResult!(true, "/cache/old.md", "old.md", native.mock.calls[0][3]);
        expect((await saveToDownloads("third.md", "more work")).error).toContain("already in progress");
        w.__paperlingOnSaveResult!(true, "/cache/current.md", "current.md", native.mock.calls[1][3]);
        expect((await current).path).toBe("/cache/current.md");
    });
});

describe("Android source write-back bridge (#305, ANDR-02)", () => {
    it("identifies Android imported/Downloads cache working-copy paths", () => {
        expect(isAndroidCachePath("/data/user/0/com.paperling/cache/open/a1b2c3d4/tmp.md")).toBe(true);
        expect(isAndroidCachePath("C:\\cache\\open\\a1b2c3d4\\tmp.md")).toBe(true);
        expect(isAndroidCachePath("/data/user/0/com.paperling/files/notes/tmp.md")).toBe(false);
        expect(isAndroidCachePath("/data/user/0/com.paperling/cache/tmp.md")).toBe(false);
    });

    it("returns not-available when syncToSource is absent and cleans up on Java throw", async () => {
        await expect(syncToSource("/cache/open/ab/a.md", "x")).resolves.toEqual({ ok: false, error: "not-available" });
        w.PaperlingAndroid = { syncToSource: () => { throw new Error("Java exception"); } };
        expect((await syncToSource("/cache/open/ab/a.md", "x")).ok).toBe(false);
        expect(w.__paperlingOnSyncResult).toBeUndefined();
    });

    it("resolves concurrent out-of-order syncs by requestId and ignores stale replies", async () => {
        vi.useFakeTimers();
        const native = vi.fn();
        w.PaperlingAndroid = { syncToSource: native };
        const first = syncToSource("/cache/open/1/a.md", "first");
        const second = syncToSource("/cache/open/2/b.md", "second");
        const id1 = native.mock.calls[0][2];
        const id2 = native.mock.calls[1][2];

        // Unknown requestId is ignored; second can settle before first.
        w.__paperlingOnSyncResult!(true, null, "stale-id");
        w.__paperlingOnSyncResult!(false, "Read-only document", id2);
        await expect(second).resolves.toEqual({ ok: false, error: "Read-only document" });
        expect(w.__paperlingOnSyncResult).toBeDefined();

        w.__paperlingOnSyncResult!(true, null, id1);
        await expect(first).resolves.toEqual({ ok: true });
        expect(w.__paperlingOnSyncResult).toBeUndefined();
    });

    it("times out an unresponsive sync and cleans up the handler", async () => {
        vi.useFakeTimers();
        w.PaperlingAndroid = { syncToSource: () => {} };
        const res = syncToSource("/cache/open/1/a.md", "x");
        await vi.advanceTimersByTimeAsync(15_000);
        expect((await res).error).toContain("timed out");
        expect(w.__paperlingOnSyncResult).toBeUndefined();
    });

    it("encodes and parses Android Downloads save sentinels without losing chosen filename", () => {
        const sentinel = makeDownloadsSentinel("notes-export.md");
        expect(parseDownloadsSentinel(sentinel)).toBe("notes-export.md");
        expect(parseDownloadsSentinel("C:/docs/plain.md")).toBeNull();
    });
});
