import { describe, expect, it, vi } from "vitest";
import { createLocalImageCache, joinImagePath } from "./localImageCache";

function setup(initialMtime: number | null = 100) {
    let mtime = initialMtime;
    let n = 0;
    const deps = {
        stat: vi.fn(async () => mtime),
        read: vi.fn(async () => new ArrayBuffer(4)),
        createUrl: vi.fn(() => `blob:${++n}`),
        revokeUrl: vi.fn(),
    };
    const get = createLocalImageCache({ ...deps, cap: 2 });
    return { get, deps, setMtime: (m: number | null) => { mtime = m; } };
}

describe("createLocalImageCache", () => {
    it("serves repeat lookups of an unchanged file from memory", async () => {
        const { get, deps } = setup();
        expect(await get("/docs", "a.svg", "image/svg+xml")).toBe("blob:1");
        expect(await get("/docs", "a.svg", "image/svg+xml")).toBe("blob:1");
        expect(deps.read).toHaveBeenCalledTimes(1);
    });

    it("re-reads an image rewritten on disk and revokes the stale URL. IMG-04", async () => {
        const { get, deps, setMtime } = setup();
        await get("/docs", "a.svg", "image/svg+xml");
        setMtime(200);
        expect(await get("/docs", "a.svg", "image/svg+xml")).toBe("blob:2");
        expect(deps.read).toHaveBeenCalledTimes(2);
        expect(deps.revokeUrl).toHaveBeenCalledWith("blob:1");
    });

    it("keeps the cached copy when the file can't be stat'ed", async () => {
        const { get, deps, setMtime } = setup();
        await get("/docs", "a.svg", "image/svg+xml");
        setMtime(null);
        expect(await get("/docs", "a.svg", "image/svg+xml")).toBe("blob:1");
        expect(deps.read).toHaveBeenCalledTimes(1);
    });

    it("evicts and revokes the least recently used entry past the cap", async () => {
        const { get, deps } = setup();
        await get("/d", "a.png", "image/png");
        await get("/d", "b.png", "image/png");
        await get("/d", "a.png", "image/png"); // a is now most recent
        await get("/d", "c.png", "image/png");
        expect(deps.revokeUrl).toHaveBeenCalledWith("blob:2"); // b evicted
    });

    it("shares one lookup between concurrent references to the same image. IMG-05", async () => {
        const { get, deps, setMtime } = setup();
        const first = await Promise.all([1, 2, 3].map(() => get("/docs", "a.svg", "image/svg+xml")));
        expect(first).toEqual(["blob:1", "blob:1", "blob:1"]);
        expect(deps.stat).toHaveBeenCalledTimes(1);
        expect(deps.read).toHaveBeenCalledTimes(1);

        setMtime(200); // rewritten on disk, then every reference re-checks on focus
        const second = await Promise.all([1, 2, 3].map(() => get("/docs", "a.svg", "image/svg+xml")));
        expect(second).toEqual(["blob:2", "blob:2", "blob:2"]);
        expect(deps.read).toHaveBeenCalledTimes(2);
        expect(deps.createUrl).toHaveBeenCalledTimes(2);
        expect(deps.revokeUrl).toHaveBeenCalledTimes(1);
        expect(deps.revokeUrl).toHaveBeenCalledWith("blob:1");
    });

    it("lets a failed lookup be retried", async () => {
        const { get, deps } = setup();
        deps.read.mockRejectedValueOnce(new Error("locked"));
        await expect(get("/docs", "a.svg", "image/svg+xml")).rejects.toThrow("locked");
        expect(await get("/docs", "a.svg", "image/svg+xml")).toBe("blob:1");
    });

    it("joins folder and relative path for the stat call", () => {
        expect(joinImagePath("/docs/", "img/a.svg")).toBe("/docs/img/a.svg");
        expect(joinImagePath("C:\\docs", "a.svg")).toBe("C:\\docs/a.svg");
    });
});
