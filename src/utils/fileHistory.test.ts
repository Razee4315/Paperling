import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    COALESCE_MS,
    MAX_AGE_MS,
    MAX_SNAPSHOT_CHARS,
    MAX_SNAPSHOTS_PER_FILE,
    createFileHistory,
    planSnapshot,
    type HistoryBackend,
    type Snapshot,
} from "./fileHistory";
import { setFileHistory } from "./persistence";

function memoryBackend() {
    let nextId = 1;
    const rows: Snapshot[] = [];
    const backend: HistoryBackend = {
        latest: async (key) => rows.filter((r) => r.key === key).at(-1) ?? null,
        list: async (key) => rows.filter((r) => r.key === key).reverse(),
        put: async (snapshot) => {
            const at = rows.findIndex((r) => r.id === snapshot.id);
            if (snapshot.id !== undefined && at >= 0) rows[at] = snapshot;
            else rows.push({ ...snapshot, id: nextId++ });
        },
        remove: async (ids) => { for (const id of ids) rows.splice(rows.findIndex((r) => r.id === id), 1); },
        removeOlderThan: async (time) => { for (const r of rows.filter((x) => x.savedAt <= time)) rows.splice(rows.indexOf(r), 1); },
        clear: async () => { rows.length = 0; },
    };
    return { backend, rows };
}

const snap = (over: Partial<Snapshot>): Snapshot => ({ id: 1, key: "k", path: "/a.md", savedAt: 0, startedAt: 0, reason: "saved", content: "old", ...over });

beforeEach(() => { setFileHistory(true); });

describe("planSnapshot (HIST-01)", () => {
    it("stores the first version of a file", () => {
        expect(planSnapshot(null, "text", "opened", 100)).toEqual({ startedAt: 100 });
    });
    it("skips a new empty note, identical text and oversized documents", () => {
        expect(planSnapshot(null, "", "saved", 100)).toBeNull();
        expect(planSnapshot(snap({}), "old", "saved", 100)).toBeNull();
        expect(planSnapshot(null, "x".repeat(MAX_SNAPSHOT_CHARS + 1), "saved", 100)).toBeNull();
    });
    it("coalesces saves inside the window into the newest text", () => {
        expect(planSnapshot(snap({ id: 7, startedAt: 1000 }), "new", "saved", 1000 + COALESCE_MS - 1)).toEqual({ replaceId: 7, startedAt: 1000 });
    });
    it("starts a new version when the window ends, even with steady saves", () => {
        expect(planSnapshot(snap({ startedAt: 1000, savedAt: 1000 + COALESCE_MS }), "new", "saved", 1000 + COALESCE_MS)).toEqual({ startedAt: 1000 + COALESCE_MS });
    });
    it("never overwrites the version a file was opened with", () => {
        expect(planSnapshot(snap({ reason: "opened", startedAt: 1000 }), "new", "saved", 1001)).toEqual({ startedAt: 1001 });
    });
    it("keeps a pre-restore copy as its own version", () => {
        expect(planSnapshot(snap({ startedAt: 1000 }), "new", "before-restore", 1001)).toEqual({ startedAt: 1001 });
    });
});

describe("createFileHistory", () => {
    it("keeps what a file was opened with, through a burst of saves", async () => {
        const { backend } = memoryBackend();
        const history = createFileHistory(() => backend);
        await history.record("/a.md", "v1", "opened", 1000);
        await history.record("/a.md", "v2", "saved", 2000);
        await history.record("/a.md", "v3", "saved", 3000);
        const list = await history.list("/a.md");
        expect(list.map((s) => s.content)).toEqual(["v3", "v1"]);
    });

    it("shares a history across path spellings", async () => {
        const { backend } = memoryBackend();
        const history = createFileHistory(() => backend);
        await history.record("C:\\Notes\\A.md", "v1", "opened", 1000);
        expect(await history.list("c:/notes/a.md")).toHaveLength(1);
    });

    it("drops the oldest beyond the per-file limit", async () => {
        const { backend } = memoryBackend();
        const history = createFileHistory(() => backend);
        for (let i = 0; i < MAX_SNAPSHOTS_PER_FILE + 5; i++) {
            await history.record("/a.md", `v${i}`, "opened", 1000 + i);
        }
        const list = await history.list("/a.md");
        expect(list).toHaveLength(MAX_SNAPSHOTS_PER_FILE);
        expect(list[0].content).toBe(`v${MAX_SNAPSHOTS_PER_FILE + 4}`);
    });

    it("expires old versions", async () => {
        const { backend, rows } = memoryBackend();
        const history = createFileHistory(() => backend);
        rows.push(snap({ id: 100, key: "/old.md", savedAt: 1000 }));
        await history.record("/a.md", "v1", "opened", 1000 + MAX_AGE_MS + 1);
        expect(rows.map((r) => r.key)).toEqual(["/a.md"]);
    });

    it("runs overlapping records in order", async () => {
        const { backend } = memoryBackend();
        const history = createFileHistory(() => backend);
        await Promise.all([
            history.record("/a.md", "v1", "opened", 1000),
            history.record("/a.md", "v2", "saved", 2000),
            history.record("/a.md", "v3", "saved", 3000),
        ]);
        expect((await history.list("/a.md")).map((s) => s.content)).toEqual(["v3", "v1"]);
    });

    it("never rejects when storage fails", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { backend } = memoryBackend();
        backend.latest = async () => { throw new Error("quota"); };
        const history = createFileHistory(() => backend);
        await expect(history.record("/a.md", "v1", "opened")).resolves.toBeUndefined();
        await expect(history.record("/a.md", "v2", "saved")).resolves.toBeUndefined();
        error.mockRestore();
    });

    it("does nothing without storage or when turned off", async () => {
        const off = createFileHistory(() => null);
        await off.record("/a.md", "v1", "opened");
        expect(await off.list("/a.md")).toEqual([]);

        const { backend, rows } = memoryBackend();
        const history = createFileHistory(() => backend);
        setFileHistory(false);
        await history.record("/a.md", "v1", "opened");
        expect(rows).toHaveLength(0);
    });

    it("clears everything", async () => {
        const { backend } = memoryBackend();
        const history = createFileHistory(() => backend);
        await history.record("/a.md", "v1", "opened", 1000);
        await history.clear();
        expect(await history.list("/a.md")).toEqual([]);
    });
});
