import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { __resetBootForTests, useFileSession, type UseFileSessionOptions } from "./useFileSession";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

afterEach(cleanup);

const files = new Map([
  ["C:/a.md", { path: "C:/a.md", name: "a.md", content: "alpha", size: 5, line_count: 1, modified: 10 }],
  ["C:/b.md", { path: "C:/b.md", name: "b.md", content: "bravo", size: 5, line_count: 1, modified: 20 }],
]);

function options(overrides: Partial<UseFileSessionOptions> = {}): UseFileSessionOptions {
  return {
    currentLine: 1,
    autoSaveEnabled: false,
    isReviewActive: false,
    clearReview: vi.fn(),
    setMode: vi.fn(),
    showToast: vi.fn(),
    restoreOnMount: false,
    ...overrides,
  };
}

describe("useFileSession", () => {
  beforeEach(() => {
    localStorage.clear();
    (invoke as Mock).mockReset().mockImplementation((command: string, args?: { path?: string }) => {
      if (command === "read_file" && args?.path) return Promise.resolve(files.get(args.path));
      return Promise.resolve(30);
    });
  });

  it("opens a file into an active tab", async () => {
    const { result } = renderHook(() => useFileSession(options()));

    await act(() => result.current.loadFile("C:/a.md"));

    expect(result.current.filePath).toBe("C:/a.md");
    expect(result.current.fileName).toBe("a.md");
    expect(result.current.content).toBe("alpha");
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("preserves edits while switching between tabs", async () => {
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    const firstId = result.current.activeTabId!;
    await act(() => result.current.loadFile("C:/b.md"));
    const secondId = result.current.activeTabId!;

    act(() => result.current.setContent("edited bravo"));
    act(() => result.current.activateTab(firstId));
    expect(result.current.content).toBe("alpha");

    act(() => result.current.activateTab(secondId));
    expect(result.current.content).toBe("edited bravo");
    expect(result.current.isDirty).toBe(true);
  });

  it("closes a clean tab and activates its neighbour", async () => {
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    const firstId = result.current.activeTabId!;
    await act(() => result.current.loadFile("C:/b.md"));

    act(() => result.current.closeTab(result.current.activeTabId!));

    expect(result.current.tabs.map((tab) => tab.fileName)).toEqual(["a.md"]);
    expect(result.current.activeTabId).toBe(firstId);
    expect(result.current.filePath).toBe("C:/a.md");
  });

  it("keeps a dirty tab open and requests confirmation before closing", async () => {
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    act(() => result.current.setContent("edited alpha"));

    act(() => result.current.closeTab(result.current.activeTabId!));

    await waitFor(() => expect(result.current.closeTabPrompt?.fileName).toBe("a.md"));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.isDirty).toBe(true);
  });

  it("New File opens a second tab after typing in a fresh Untitled tab (TABS-17)", () => {
    const { result } = renderHook(() => useFileSession(options()));
    act(() => result.current.handleNewFile());
    act(() => result.current.setContent("my first note"));
    act(() => result.current.handleNewFile());
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.content).toBe("");
    act(() => result.current.activateTab(result.current.tabs[0].id));
    expect(result.current.content).toBe("my first note");
  });

  it("a save that finds the file changed on disk raises the conflict, and leaving the tab parks it (EXT-04/06)", async () => {
    let diskMtime = 20;
    (invoke as Mock).mockImplementation((command: string, args?: { path?: string }) => {
      if (command === "read_file" && args?.path) return Promise.resolve(files.get(args.path));
      if (command === "get_file_info") return Promise.resolve({ modified: diskMtime });
      return Promise.resolve(30);
    });
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    const aId = result.current.activeTabId!;
    await act(() => result.current.loadFile("C:/b.md"));
    const bId = result.current.activeTabId!;
    act(() => result.current.setContent("my bravo edits"));

    diskMtime = 99; // another program saved b.md
    await act(() => result.current.handleSaveFile());
    expect(invoke).not.toHaveBeenCalledWith("save_file", expect.anything());
    expect(result.current.conflictPrompt?.fileName).toBe("b.md");

    // Switching away must not count as "keep mine".
    act(() => result.current.activateTab(aId));
    expect(result.current.isAutosaveParked("C:/b.md")).toBe(true);
    act(() => result.current.activateTab(bId));
    expect(result.current.conflictPrompt?.fileName).toBe("b.md");

    // Keep mine absorbs the change, so the next save goes through.
    act(() => result.current.handleConflictKeepMine());
    await act(() => result.current.handleSaveFile());
    expect(invoke).toHaveBeenCalledWith("save_file", { path: "C:/b.md", content: "my bravo edits" });
  });
});

describe("useFileSession crash recovery (HOT-02/04)", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetBootForTests();
    (invoke as Mock).mockReset().mockImplementation((command: string, args?: { path?: string }) => {
      if (command === "get_cli_file") return Promise.resolve(null);
      if (command === "read_file" && args?.path) return Promise.resolve(files.get(args.path));
      return Promise.resolve(30);
    });
  });

  const seedBackup = (originalContent: string) =>
    localStorage.setItem(
      "paperling.buffer-backup.v1",
      JSON.stringify([{ filePath: "C:/a.md", fileName: "a.md", content: "alpha plus unsaved work", originalContent }]),
    );

  it("restores a recovered buffer as DIRTY and keeps its backup", async () => {
    seedBackup("alpha");
    const { result } = renderHook(() => useFileSession(options({ restoreOnMount: true })));
    await waitFor(() => expect(result.current.booting).toBe(false));
    expect(result.current.content).toBe("alpha plus unsaved work");
    expect(result.current.isDirty).toBe(true);
    expect(result.current.conflictPrompt).toBeNull();
    // The debounced backup mirror must still hold the recovered text.
    await new Promise((r) => setTimeout(r, 1000));
    expect(localStorage.getItem("paperling.buffer-backup.v1")).toContain("alpha plus unsaved work");
  });

  it("raises the conflict when the file changed on disk after the crash", async () => {
    seedBackup("an older alpha");
    const { result } = renderHook(() => useFileSession(options({ restoreOnMount: true })));
    await waitFor(() => expect(result.current.booting).toBe(false));
    expect(result.current.isDirty).toBe(true);
    expect(result.current.conflictPrompt?.fileName).toBe("a.md");
    expect(result.current.isAutosaveParked("C:/a.md")).toBe(true);
  });
});
