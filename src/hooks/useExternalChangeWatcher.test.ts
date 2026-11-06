import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type RefObject } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useExternalChangeWatcher, type UseExternalChangeWatcherOptions } from "./useExternalChangeWatcher";
import { saveTextFile } from "../utils/fileIO";

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
    expect(o.onReloaded).toHaveBeenCalledWith("focus");
    expect(o.onConflict).not.toHaveBeenCalled();
    expect(o.knownMtimeRef.current).toBe(200); // advanced so it won't re-fire
  });

  it("also picks up changes on the visible-window interval, without focus. EXT-07", async () => {
    vi.useFakeTimers();
    try {
      (invoke as Mock).mockResolvedValue({ modified: 200 });
      const o = setup();
      await vi.advanceTimersByTimeAsync(1500);
      expect(o.reload).toHaveBeenCalledWith("C:/doc.md");
      expect(o.onReloaded).toHaveBeenCalledWith("interval");
    } finally {
      vi.useRealTimers();
    }
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

  it("does not report our own save, landing mid-stat, as a change on disk. EXT-08", async () => {
    // The stat is answered after our save started writing: it sees the new
    // mtime before the save path could record it.
    let answerStat!: (info: { modified: number }) => void;
    let finishSave!: (mtime: number) => void;
    (invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === "get_file_info") return new Promise((resolve) => { answerStat = resolve; });
      if (cmd === "save_file") return new Promise((resolve) => { finishSave = resolve; });
      return Promise.resolve(undefined);
    });
    const o = setup({ contentRef: ref("typed"), originalContentRef: ref("saved") });
    window.dispatchEvent(new Event("focus"));
    const saving = saveTextFile("C:/doc.md", "typed");
    answerStat({ modified: 200 });
    await new Promise((r) => setTimeout(r, 0));
    finishSave(200);
    await saving;
    expect(o.onConflict).not.toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
    expect(o.knownMtimeRef.current).toBe(100); // left for the save path to record
  });

  it("skips a check that starts while our own save is in flight. EXT-08", async () => {
    let finishSave!: (mtime: number) => void;
    (invoke as Mock).mockImplementation((cmd: string) =>
      cmd === "save_file" ? new Promise((resolve) => { finishSave = resolve; }) : Promise.resolve({ modified: 200 }),
    );
    const o = setup();
    const saving = saveTextFile("C:/doc.md", "x");
    await focus();
    expect(invoke).not.toHaveBeenCalledWith("get_file_info", expect.anything());
    finishSave(200);
    await saving;
    await focus(); // the next check runs normally
    expect(invoke).toHaveBeenCalledWith("get_file_info", { path: "C:/doc.md" });
    expect(o.reload).toHaveBeenCalled();
  });

  it("raises the conflict when the reload declined because the buffer was edited during the read. EXT-09", async () => {
    (invoke as Mock).mockResolvedValue({ modified: 200 });
    const o = setup({ reload: vi.fn().mockResolvedValue(false) });
    await focus();
    expect(o.reload).toHaveBeenCalledWith("C:/doc.md");
    expect(o.onReloaded).not.toHaveBeenCalled();
    expect(o.onConflict).toHaveBeenCalled();
  });

  // --- EXT-11: the user switches tabs while the check for the old tab is on
  // its way to the disk, so its result must not touch the new tab. ---

  function switchDuringStat(over: Partial<UseExternalChangeWatcherOptions> = {}) {
    let answerStat!: (info: { modified: number }) => void;
    (invoke as Mock).mockImplementation((cmd: string) =>
      cmd === "get_file_info" ? new Promise((resolve) => { answerStat = resolve; }) : Promise.resolve(undefined),
    );
    const o = setup({ filePathRef: ref<string | null>("C:/left.md"), knownMtimeRef: ref(500), ...over });
    window.dispatchEvent(new Event("focus"));
    const land = async (diskMtime: number) => {
      // The session swaps these to the new tab's values as it activates it.
      o.filePathRef.current = "C:/new.md";
      o.knownMtimeRef.current = 100;
      answerStat({ modified: diskMtime });
      await new Promise((r) => setTimeout(r, 0));
    };
    return { o, land };
  }

  it("does not reload the tab the user just left. EXT-11", async () => {
    // left.md's mtime is newer than the new tab's: compared across tabs it
    // looked changed, and reload("C:/left.md") dragged the user back to it.
    const { o, land } = switchDuringStat();
    await land(500);
    expect(o.reload).not.toHaveBeenCalled();
    expect(o.onReloaded).not.toHaveBeenCalled();
  });

  it("does not raise a false conflict on a dirty new tab. EXT-11", async () => {
    const { o, land } = switchDuringStat({ contentRef: ref("typed"), originalContentRef: ref("saved") });
    await land(500);
    expect(o.onConflict).not.toHaveBeenCalled();
  });

  it("leaves the new tab's known mtime alone. EXT-11", async () => {
    // Writing the old file's mtime onto the new tab would hide a later
    // external edit from every guard that compares against it.
    const { o, land } = switchDuringStat();
    await land(500);
    expect(o.knownMtimeRef.current).toBe(100);
  });

  it("does not raise a content conflict when the tab changes during the fallback read. EXT-11", async () => {
    let answerRead!: (file: { content: string }) => void;
    (invoke as Mock).mockImplementation((cmd: string) =>
      cmd === "read_file"
        ? new Promise((resolve) => { answerRead = resolve; })
        : Promise.resolve({ modified: 200 }),
    );
    const o = setup({ knownMtimeRef: ref(0), contentRef: ref("typed"), originalContentRef: ref("saved") });
    await focus();
    o.filePathRef.current = "C:/new.md";
    answerRead({ content: "different from the new tab" });
    await new Promise((r) => setTimeout(r, 0));
    expect(o.onConflict).not.toHaveBeenCalled();
  });

  it("ignores focus when no file is open", async () => {
    const o = setup({ filePathRef: ref<string | null>(null) });
    await focus();
    expect(invoke).not.toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
  });

  // --- EXT-10: the mtime baseline can be unusable (0) — never treat that as
  // "unchanged"; decide by content instead. ---

  it("re-anchors a lost mtime by reloading a clean buffer, even when the baseline mtime is 0", async () => {
    (invoke as Mock).mockResolvedValue({ modified: 200 });
    const o = setup({ knownMtimeRef: ref(0) });
    await focus();
    expect(o.reload).toHaveBeenCalledWith("C:/doc.md");
    expect(o.onReloaded).toHaveBeenCalledWith("focus");
    expect(o.knownMtimeRef.current).toBe(200); // re-armed for ordinary mtime detection
  });

  it("raises the conflict when the baseline mtime is 0, the buffer is dirty, and the disk content differs", async () => {
    (invoke as Mock).mockImplementation((cmd: string) =>
      cmd === "get_file_info"
        ? Promise.resolve({ modified: 200 })
        : Promise.resolve({ path: "C:/doc.md", content: "external edit" }),
    );
    const o = setup({ knownMtimeRef: ref(0), contentRef: ref("typed"), originalContentRef: ref("same") });
    await focus();
    expect(o.onConflict).toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
    expect(o.knownMtimeRef.current).toBe(200); // adopted so Keep-mine can absorb
  });

  it("stays quiet when the baseline mtime is 0, the buffer is dirty, but the disk content matches", async () => {
    // The on-disk mtime may simply have been missing all along; only a real
    // content difference deserves the dialog.
    (invoke as Mock).mockImplementation((cmd: string) =>
      cmd === "get_file_info"
        ? Promise.resolve({ modified: 200 })
        : Promise.resolve({ path: "C:/doc.md", content: "same" }),
    );
    const o = setup({ knownMtimeRef: ref(0), contentRef: ref("typed"), originalContentRef: ref("same") });
    await focus();
    expect(o.onConflict).not.toHaveBeenCalled();
    expect(o.reload).not.toHaveBeenCalled();
  });

  it("does not re-read a file that reports no mtime on either side (the write guard covers it)", async () => {
    (invoke as Mock).mockResolvedValue({ modified: 0 });
    const o = setup({ knownMtimeRef: ref(0) });
    await focus();
    expect(invoke).toHaveBeenCalledTimes(1); // the stat only — no read_file
    expect(o.reload).not.toHaveBeenCalled();
    expect(o.onConflict).not.toHaveBeenCalled();
  });
});
