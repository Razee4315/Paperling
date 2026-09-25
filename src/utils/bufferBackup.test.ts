import { describe, it, expect, beforeEach, vi } from "vitest";
import { collectBufferBackups, type TabState } from "./tabsModel";
import { loadBufferBackups, saveBufferBackups, type BufferBackup } from "./bufferBackup";

const tab = (over: Partial<TabState> & { id: string }): TabState => ({
  filePath: null,
  fileName: "Untitled.md",
  content: "",
  originalContent: "",
  fileSize: 0,
  knownMtime: 0,
  ...over,
});

describe("collectBufferBackups (HOT-01)", () => {
  it("collects only dirty tabs, reading the active tab from live state", () => {
    const tabs: TabState[] = [
      tab({ id: "a", filePath: "C:/clean.md", fileName: "clean.md", content: "x", originalContent: "x" }),
      tab({ id: "b", filePath: "C:/bg.md", fileName: "bg.md", content: "bg draft", originalContent: "bg" }),
      tab({ id: "c", filePath: null, fileName: "Untitled-1.md", content: "old", originalContent: "old" }),
    ];
    const backups = collectBufferBackups(
      tabs,
      "c",
      { filePath: null, fileName: "Untitled-1.md", content: "live typing", originalContent: "old" },
      7,
    );
    expect(backups).toEqual([
      { filePath: "C:/bg.md", fileName: "bg.md", content: "bg draft", originalContent: "bg", cursorLine: undefined },
      { filePath: null, fileName: "Untitled-1.md", content: "live typing", originalContent: "old", cursorLine: 7 },
    ]);
  });
});

describe("bufferBackup store", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips through localStorage", () => {
    const list: BufferBackup[] = [
      { filePath: null, fileName: "Untitled-1.md", content: "draft", originalContent: "", cursorLine: 3 },
    ];
    saveBufferBackups(list);
    expect(loadBufferBackups()).toEqual(list);
  });

  it("is empty-safe and drops corrupted entries", () => {
    expect(loadBufferBackups()).toEqual([]);
    localStorage.setItem("paperling.buffer-backup.v1", "{not json");
    expect(loadBufferBackups()).toEqual([]);
  });

  it("clears the store when the backup list becomes empty", () => {
    saveBufferBackups([{ filePath: null, fileName: "u.md", content: "x", originalContent: "" }]);
    saveBufferBackups([]);
    expect(loadBufferBackups()).toEqual([]);
  });

  it("skips oversized buffers instead of truncating them", () => {
    const big = "x".repeat(1_000_001);
    saveBufferBackups([
      { filePath: null, fileName: "big.md", content: big, originalContent: "" },
      { filePath: null, fileName: "ok.md", content: "small", originalContent: "" },
    ]);
    const loaded = loadBufferBackups();
    expect(loaded.map((b) => b.fileName)).toEqual(["ok.md"]);
  });
});

describe("saveBufferBackups quota handling (HOT-05)", () => {
  beforeEach(() => localStorage.clear());

  it("drops the stale snapshot and keeps what fits when storage is full", () => {
    const small: BufferBackup = { filePath: null, fileName: "a.md", content: "small", originalContent: "" };
    const big: BufferBackup = { filePath: null, fileName: "b.md", content: "x".repeat(5000), originalContent: "" };
    saveBufferBackups([{ ...small, content: "OLD stale text" }]);
    const real = Storage.prototype.setItem;
    // Simulate a quota: anything over 1000 chars throws.
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.length > 1000) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    saveBufferBackups([big, small]);
    spy.mockRestore();
    expect(loadBufferBackups().map((b) => b.content)).toEqual(["small"]);
  });
});
