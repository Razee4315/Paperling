/**
 * Local file history (HIST-01): earlier versions of a document, kept by the app
 * on this computer. VS Code's Timeline, Obsidian's File Recovery. Crash recovery
 * (bufferBackup) only covers UNSAVED text: an accidental select-all-and-type
 * that autosave then wrote to disk could not be undone once the tab closed.
 *
 * A copy is taken whenever a file is read (so the version from before your edits
 * exists) and whenever it is written, both through fileIO.ts, the one path every
 * document takes. Nothing here touches the file itself: restoring is an ordinary
 * edit in the buffer, undoable and unsaved until the user saves.
 *
 * Stored in IndexedDB, not localStorage: copies are whole documents, and filling
 * localStorage would break the settings and crash recovery living there. Cost is
 * bounded by the limits below, and any storage failure is swallowed, because
 * history must never get in the way of saving.
 */

import { getFileHistory } from "./persistence";
import { pathKey } from "./tabsModel";

export type SnapshotReason = "opened" | "saved" | "before-restore";

export interface Snapshot {
    /** Assigned by the store. */
    id?: number;
    /** Normalized path (pathKey), so C:\A.md and c:/a.md share a history. */
    key: string;
    path: string;
    savedAt: number;
    /** When this entry's coalescing window began; see planSnapshot. */
    startedAt: number;
    reason: SnapshotReason;
    content: string;
}

export interface HistoryBackend {
    latest(key: string): Promise<Snapshot | null>;
    /** Newest first. */
    list(key: string): Promise<Snapshot[]>;
    /** Adds, or replaces the entry with the same id. */
    put(snapshot: Snapshot): Promise<void>;
    remove(ids: number[]): Promise<void>;
    removeOlderThan(time: number): Promise<void>;
    clear(): Promise<void>;
}

/** Saves within this window collapse into one entry holding the newest text, or
 *  autosave would write a version every few seconds of typing. The window is
 *  measured from the entry's START, so hours of steady typing still leave a
 *  version every five minutes instead of one ever-replaced entry. */
export const COALESCE_MS = 5 * 60 * 1000;
export const MAX_SNAPSHOTS_PER_FILE = 40;
/** Larger documents are skipped rather than truncated: half a version restored
 *  as if whole is worse than none. Same limit as crash recovery, in spirit. */
export const MAX_SNAPSHOT_CHARS = 2_000_000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type SnapshotPlan = null | { replaceId?: number; startedAt: number };

/** Whether and how to store `content`. Pure, so the rules are testable. */
export function planSnapshot(latest: Snapshot | null, content: string, reason: SnapshotReason, now: number): SnapshotPlan {
    if (content.length > MAX_SNAPSHOT_CHARS) return null;
    if (!latest) return content ? { startedAt: now } : null; // a brand-new empty note has no past
    if (latest.content === content) return null;
    const sameBurst = reason === "saved" && latest.reason === "saved" && now - latest.startedAt < COALESCE_MS;
    return sameBurst ? { replaceId: latest.id, startedAt: latest.startedAt } : { startedAt: now };
}

export function createFileHistory(backend: () => HistoryBackend | null) {
    // One write at a time: the plan reads the latest entry, so two overlapping
    // records of one file could both replace it.
    let queue: Promise<unknown> = Promise.resolve();
    let pruned = false;

    const write = async (path: string, content: string, reason: SnapshotReason, now: number) => {
        const store = backend();
        if (!store) return;
        const key = pathKey(path);
        const plan = planSnapshot(await store.latest(key), content, reason, now);
        if (!plan) return;
        await store.put({
            ...(plan.replaceId !== undefined ? { id: plan.replaceId } : {}),
            key, path, savedAt: now, startedAt: plan.startedAt, reason, content,
        });
        const all = await store.list(key);
        const excess = all.slice(MAX_SNAPSHOTS_PER_FILE).flatMap((s) => (s.id === undefined ? [] : [s.id]));
        if (excess.length > 0) await store.remove(excess);
        if (!pruned) {
            pruned = true;
            await store.removeOlderThan(now - MAX_AGE_MS);
        }
    };

    return {
        /** Never rejects: a history failure must not fail the read or save. */
        record(path: string, content: string, reason: SnapshotReason, now = Date.now()): Promise<void> {
            if (!getFileHistory()) return Promise.resolve();
            const run = queue.then(() => write(path, content, reason, now)).catch((err) => {
                console.error("Could not record file history:", err);
            });
            queue = run;
            return run;
        },
        async list(path: string): Promise<Snapshot[]> {
            await queue; // include what was just recorded
            return (await backend()?.list(pathKey(path))) ?? [];
        },
        async clear(): Promise<void> {
            await queue;
            await backend()?.clear();
        },
    };
}

const DB_NAME = "paperling-history";
const STORE = "snapshots";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
            store.createIndex("key", "key");
            store.createIndex("savedAt", "savedAt");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function indexedDbBackend(): HistoryBackend {
    const db = openDb();
    const run = async <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
        const tx = (await db).transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(request ? request.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    };
    return {
        // Ids only grow, so the last id under a key is its newest entry.
        latest: async (key) => {
            let found: Snapshot | null = null;
            await run("readonly", (store) => {
                const cursor = store.index("key").openCursor(IDBKeyRange.only(key), "prev");
                cursor.onsuccess = () => { found = (cursor.result?.value as Snapshot | undefined) ?? null; };
            });
            return found;
        },
        list: async (key) => {
            const all = await run<Snapshot[]>("readonly", (store) => store.index("key").getAll(IDBKeyRange.only(key)));
            return (all ?? []).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
        },
        put: async (snapshot) => { await run("readwrite", (store) => store.put(snapshot)); },
        remove: async (ids) => { await run("readwrite", (store) => { ids.forEach((id) => store.delete(id)); }); },
        removeOlderThan: async (time) => {
            await run("readwrite", (store) => {
                const cursor = store.index("savedAt").openCursor(IDBKeyRange.upperBound(time));
                cursor.onsuccess = () => {
                    if (!cursor.result) return;
                    cursor.result.delete();
                    cursor.result.continue();
                };
            });
        },
        clear: async () => { await run("readwrite", (store) => { store.clear(); }); },
    };
}

let backendInstance: HistoryBackend | null = null;
export const fileHistory = createFileHistory(() => {
    if (typeof indexedDB === "undefined") return null;
    backendInstance ??= indexedDbBackend();
    return backendInstance;
});
