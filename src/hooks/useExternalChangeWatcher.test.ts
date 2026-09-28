import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type RefObject } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useExternalChangeWatcher, type UseExternalChangeWatcherOptions } from "./useExternalChangeWatcher";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Vitest globals are off, so testing-library's auto-cleanup isn't registered.
// Unmount each hook manually so its window "focus" listener doesn't leak into
// the next test (which would fire stale listeners and double-count invoke).
afterEach(cleanup);

const ref = <T,>(value: T): RefObject<T> => ({ current: value });

function setup(over: Partial<UseExternalChangeWatcherOptions> = {}) {
  const opts: UseExternalChangeWatcherOptions = {
    filePathRef: ref<string | null>("C:/doc.md"),
    contentRef: ref("same"),
    originalContentRef: ref("same"),
    knownMtimeRef: ref(100),
    isReviewActiveRef: ref(false),
    reload: vi.fn().mockResolvedValue(undefined),
    onReloaded: vi.fn(),
    onConflict: vi.fn(),
    ...over,
  };
  renderHook(() => useExternalChangeWatcher(opts));
  return opts;
}

// Dispatch a window focus and let the async handler settle.
async function focus() {
  window.dispatchEvent(new Event("focus"));
  await new Promise((r) => setTimeout(r, 0));
}

describe("useExternalChangeWatcher", () => {
  beforeEach(() => (invoke as Mock).mockReset());

  it("reloads silently when the file changed on disk and the buffer is clean", async () => {
    (invoke as Mock).mockResolvedValue({ modified: 200 });
    const o = setup();
    await focus();
    expect(o.reload).toHaveBeenCalledWith("C:/doc.md");
    expect(o.onReloaded).toHaveBeenCalled();
    expect(o.onConflict).not.toHaveBeenCalled();
    expect(o.knownMtimeRef.current).toBe(200); // advanced so it won't re-fire
  });

  it("warns instead of reloading when the buffer is dirty", async () => {
    (invoke as Mock).mockResolvedValue({ modified: 200 });
    const o = setup({ contentRef: ref("edited"), originalContentRef: ref("same") });
    await focus();
    expect(o.onConflict).toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
  });

  it("does nothing when the on-disk mtime is not newer", async () => {
    (invoke as Mock).mockResolvedValue({ modified: 100 });
    const o = setup({ knownMtimeRef: ref(100) });
    await focus();
    expect(o.reload).not.toHaveBeenCalled();
    expect(o.onConflict).not.toHaveBeenCalled();
  });

  it("does not stat while an AI review is pending", async () => {
    const o = setup({ isReviewActiveRef: ref(true) });
    await focus();
    expect(invoke).not.toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
  });

  it("keeps working after a review-time focus (no stranded in-flight flag)", async () => {
    // Regression guard: an early return must not leave the `checking` latch set,
    // which would silently kill detection for the rest of the session.
    const isReviewActiveRef = ref(true);
    (invoke as Mock).mockResolvedValue({ modified: 200 });
    const o = setup({ isReviewActiveRef });

    await focus(); // review active → skipped
    expect(invoke).not.toHaveBeenCalled();

    isReviewActiveRef.current = false; // review ended
    await focus(); // must run now
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(o.reload).toHaveBeenCalledWith("C:/doc.md");
  });

  it("ignores focus when no file is open", async () => {
    const o = setup({ filePathRef: ref<string | null>(null) });
    await focus();
    expect(invoke).not.toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
  });
});
