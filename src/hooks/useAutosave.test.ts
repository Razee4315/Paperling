import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAutosave, type UseAutosaveOptions } from "./useAutosave";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const base = (over: Partial<UseAutosaveOptions> = {}): UseAutosaveOptions => ({
  enabled: true,
  filePath: "C:/doc.md",
  content: "new",
  originalContent: "old",
  isReviewActive: false,
  conflictPending: false,
  onSaved: vi.fn(),
  onError: vi.fn(),
  ...over,
});

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (invoke as Mock).mockReset().mockResolvedValue(1700000000000);
  });
  afterEach(() => vi.useRealTimers());

  it("does not save when disabled", async () => {
    renderHook((p: UseAutosaveOptions) => useAutosave(p), { initialProps: base({ enabled: false }) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not save an Untitled buffer (no path)", async () => {
    renderHook((p: UseAutosaveOptions) => useAutosave(p), { initialProps: base({ filePath: null }) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not save when the buffer is clean", async () => {
    renderHook((p: UseAutosaveOptions) => useAutosave(p), { initialProps: base({ content: "x", originalContent: "x" }) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does NOT save while an AI review is pending, even when dirty (AI-01)", async () => {
    const onSaved = vi.fn();
    renderHook((p: UseAutosaveOptions) => useAutosave(p), {
      initialProps: base({ isReviewActive: true, onSaved }),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does NOT save while a disk conflict is pending, and resumes after it resolves (EXT-02)", async () => {
    const onSaved = vi.fn();
    const { rerender } = renderHook((p: UseAutosaveOptions) => useAutosave(p), {
      initialProps: base({ conflictPending: true, onSaved }),
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    // Resolving the conflict (dialog answered) re-arms the debounce normally.
    rerender(base({ conflictPending: false, onSaved }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(invoke).toHaveBeenCalledWith("save_file", { path: "C:/doc.md", content: "new" });
    expect(onSaved).toHaveBeenCalledWith(1700000000000, "new");
  });

  it("saves after the debounce and reports the new mtime + saved content", async () => {
    const onSaved = vi.fn();
    renderHook((p: UseAutosaveOptions) => useAutosave(p), { initialProps: base({ onSaved }) });

    // Nothing before the debounce elapses.
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(invoke).toHaveBeenCalledWith("save_file", { path: "C:/doc.md", content: "new" });
    expect(onSaved).toHaveBeenCalledWith(1700000000000, "new");
  });

  it("coalesces rapid edits — only the latest content is written", async () => {
    const onSaved = vi.fn();
    const { rerender } = renderHook((p: UseAutosaveOptions) => useAutosave(p), {
      initialProps: base({ content: "a", onSaved }),
    });
    await vi.advanceTimersByTimeAsync(1000); // not yet
    rerender(base({ content: "ab", onSaved }));
    await vi.advanceTimersByTimeAsync(1000); // resets, still not yet
    rerender(base({ content: "abc", onSaved }));
    await vi.advanceTimersByTimeAsync(1600);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("save_file", { path: "C:/doc.md", content: "abc" });
  });

  it("throttles repeated failures to onError", async () => {
    (invoke as Mock).mockRejectedValue("Disk full");
    const onError = vi.fn();
    const { rerender } = renderHook((p: UseAutosaveOptions) => useAutosave(p), {
      initialProps: base({ content: "a", onError }),
    });
    await vi.advanceTimersByTimeAsync(1600);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Disk full");

    // A second failure shortly after stays silent (30s throttle window).
    rerender(base({ content: "b", onError }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
