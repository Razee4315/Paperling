import { describe, it, expect, beforeEach } from "vitest";
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
