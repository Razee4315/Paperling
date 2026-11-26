import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { fileHistory } from "./fileHistory";
import {
  encodingLabel,
  idleWriteToken,
  readTextFile,
  retargetEncodings,
  saveTextFile,
  type FileEncoding,
} from "./fileIO";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("./fileHistory", () => ({ fileHistory: { record: vi.fn() } }));

/** save_file's refusal, as pinned by refused_encodings_never_touch_the_file. */
const REFUSED = "Unrepresentable text: windows-1252 cannot store U+4E2D";

/**
 * A disk holding one encoding. save_file refuses like Rust does, and each
 * get_file_info answers with the next value of `mtimes`.
 */
function backend(encoding: FileEncoding, mtimes: (number | Error)[] = [1, 1]): void {
  (invoke as Mock).mockReset().mockImplementation(async (cmd: string, args: { path: string; content: string; encoding?: FileEncoding }) => {
    if (cmd === "read_file") return { path: args.path, content: encoding === "utf-8-bom" ? "\uFEFFx" : "x", encoding };
    if (cmd === "get_file_info") {
      const next = mtimes.shift();
      if (next instanceof Error) throw next;
      return { modified: next };
    }
    if (args.encoding === "windows-1252" && args.content.includes("中")) throw REFUSED;
    return 7;
  });
}

const saves = () => (invoke as Mock).mock.calls.filter(([cmd]) => cmd === "save_file").map(([, args]) => args);

describe("fileIO encodings (ENC-03)", () => {
  beforeEach(() => (ask as Mock).mockReset());

  it("saves in the encoding the file was read with, whatever the path's case", async () => {
    backend("utf-16le");
    await readTextFile("C:/Enc/Wide.md");
    await saveTextFile("c:/enc/wide.md", "edited");
    expect(saves()).toEqual([{ path: "c:/enc/wide.md", content: "edited", encoding: "utf-16le" }]);
  });

  it("replaces the remembered encoding on every read", async () => {
    backend("utf-16be");
    await readTextFile("C:/Enc/Reread.md");
    backend("utf-8");
    await readTextFile("C:/Enc/Reread.md");
    await saveTextFile("C:/Enc/Reread.md", "edited");
    expect(saves()).toEqual([{ path: "C:/Enc/Reread.md", content: "edited", encoding: "utf-8" }]);
  });

  it("sends no encoding for a path it never read, so Rust keeps the file's own", async () => {
    backend("utf-8");
    await saveTextFile("C:/Enc/Never-read.md", "text");
    expect(saves()).toEqual([{ path: "C:/Enc/Never-read.md", content: "text" }]);
  });

  it("restores a UTF-8 BOM alongside the encoding", async () => {
    backend("utf-8-bom");
    const data = await readTextFile<{ content: string }>("C:/Enc/Bom.md");
    expect(data.content).toBe("x");
    await saveTextFile("C:/Enc/Bom.md", "edited");
    expect(saves()).toEqual([{ path: "C:/Enc/Bom.md", content: "\uFEFFedited", encoding: "utf-8-bom" }]);
  });

  it("gives file history the text without its BOM", async () => {
    (fileHistory.record as Mock).mockClear();
    backend("utf-8-bom");
    await readTextFile("C:/Enc/Bom-history.md");
    await saveTextFile("C:/Enc/Bom-history.md", "edited");
    expect(fileHistory.record).toHaveBeenLastCalledWith("C:/Enc/Bom-history.md", "edited", "saved");
  });

  it("names the encoding for the status bar, and nothing for plain UTF-8", async () => {
    const labels: [FileEncoding, string | null][] = [
      ["utf-8", null],
      ["utf-8-bom", "UTF-8 BOM"],
      ["utf-16le", "UTF-16 LE"],
      ["utf-16be", "UTF-16 BE"],
      ["windows-1252", "Windows-1252"],
    ];
    for (const [encoding, label] of labels) {
      backend(encoding);
      await readTextFile("C:/Enc/Label.md");
      expect(encodingLabel("C:/Enc/Label.md")).toBe(label);
    }
    expect(encodingLabel("C:/Enc/Unread.md")).toBeNull();
    expect(encodingLabel(null)).toBeNull();
  });

  it("follows a renamed file or folder and forgets a trashed one", async () => {
    backend("utf-16le");
    await readTextFile("C:/Enc/Old/a.md");
    await readTextFile("C:/Enc/Old/sub/b.md");
    await readTextFile("C:/Enc/Older/c.md");
    await readTextFile("C:/Enc/Gone.md");

    retargetEncodings("C:/Enc/Old", "C:/Enc/New");
    expect(encodingLabel("C:/Enc/New/a.md")).toBe("UTF-16 LE");
    expect(encodingLabel("C:/Enc/New/sub/b.md")).toBe("UTF-16 LE");
    expect(encodingLabel("C:/Enc/Old/a.md")).toBeNull();
    // A sibling that merely shares the prefix stays where it is.
    expect(encodingLabel("C:/Enc/Older/c.md")).toBe("UTF-16 LE");

    retargetEncodings("C:/Enc/Gone.md", null);
    expect(encodingLabel("C:/Enc/Gone.md")).toBeNull();
  });
});

describe("fileIO text an encoding can't hold (ENC-04)", () => {
  beforeEach(() => (ask as Mock).mockReset());

  it("writes representable text without asking", async () => {
    backend("windows-1252");
    await readTextFile("C:/Conv/Fine.md");
    await expect(saveTextFile("C:/Conv/Fine.md", "café")).resolves.toBe(7);
    expect(ask).not.toHaveBeenCalled();
  });

  it("converts to UTF-8 only after the user agrees, and stays UTF-8 afterwards", async () => {
    backend("windows-1252");
    (ask as Mock).mockResolvedValue(true);
    await readTextFile("C:/Conv/Yes.md");

    await expect(saveTextFile("C:/Conv/Yes.md", "中")).resolves.toBe(7);

    expect(ask).toHaveBeenCalledTimes(1);
    expect((ask as Mock).mock.calls[0][0]).toContain('"中" (U+4E2D)');
    expect(saves()).toEqual([
      { path: "C:/Conv/Yes.md", content: "中", encoding: "windows-1252" },
      { path: "C:/Conv/Yes.md", content: "中", encoding: "utf-8" },
    ]);
    expect(encodingLabel("C:/Conv/Yes.md")).toBeNull();

    await saveTextFile("C:/Conv/Yes.md", "中文");
    expect(saves().at(-1)).toEqual({ path: "C:/Conv/Yes.md", content: "中文", encoding: "utf-8" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the user declines, and fails so the text stays unsaved", async () => {
    backend("windows-1252");
    (ask as Mock).mockResolvedValue(false);
    await readTextFile("C:/Conv/No.md");

    await expect(saveTextFile("C:/Conv/No.md", "中")).rejects.toThrow(/^Not saved: "No\.md" is stored as Windows-1252/);

    expect(saves()).toHaveLength(1); // only the refused attempt
    expect(encodingLabel("C:/Conv/No.md")).toBe("Windows-1252");
  });

  it("never opens a dialog from a background save", async () => {
    backend("windows-1252");
    await readTextFile("C:/Conv/Auto.md");

    await expect(saveTextFile("C:/Conv/Auto.md", "中", { background: true })).rejects.toThrow(/Save it yourself/);

    expect(ask).not.toHaveBeenCalled();
    expect(saves()).toHaveLength(1);
  });

  it("does not count the open question as a write in flight (EXT-08)", async () => {
    backend("windows-1252");
    let tokenDuringQuestion: number | null = null;
    (ask as Mock).mockImplementation(async () => {
      tokenDuringQuestion = idleWriteToken();
      return false;
    });
    await readTextFile("C:/Conv/Token.md");
    await expect(saveTextFile("C:/Conv/Token.md", "中")).rejects.toThrow();
    expect(tokenDuringQuestion).not.toBeNull();
  });

  it("cancels the conversion when another program wrote the file during the question", async () => {
    backend("windows-1252", [1, 2]);
    (ask as Mock).mockResolvedValue(true);
    await readTextFile("C:/Conv/Raced.md");

    await expect(saveTextFile("C:/Conv/Raced.md", "中")).rejects.toThrow(/changed on disk/);

    expect(saves()).toHaveLength(1);
    expect(encodingLabel("C:/Conv/Raced.md")).toBe("Windows-1252");
  });

  it("cancels the conversion when the file was deleted during the question", async () => {
    backend("windows-1252", [1, new Error("File not found")]);
    (ask as Mock).mockResolvedValue(true);
    await readTextFile("C:/Conv/Deleted.md");

    await expect(saveTextFile("C:/Conv/Deleted.md", "中")).rejects.toThrow(/changed on disk/);

    expect(saves()).toHaveLength(1);
  });

  it("adds to file history only once a write has landed", async () => {
    const saved = () => (fileHistory.record as Mock).mock.calls.filter(([, , reason]) => reason === "saved");
    (fileHistory.record as Mock).mockClear();
    backend("windows-1252", [1, 1, 1]);
    await readTextFile("C:/Conv/History.md");

    (ask as Mock).mockResolvedValue(false);
    await expect(saveTextFile("C:/Conv/History.md", "中")).rejects.toThrow();
    expect(saved()).toEqual([]);

    await expect(saveTextFile("C:/Conv/History.md", "中", { background: true })).rejects.toThrow();
    expect(saved()).toEqual([]);

    (ask as Mock).mockResolvedValue(true);
    await saveTextFile("C:/Conv/History.md", "中");
    expect(saved()).toEqual([["C:/Conv/History.md", "中", "saved"]]);

    await saveTextFile("C:/Conv/History.md", "plain");
    expect(saved().at(-1)).toEqual(["C:/Conv/History.md", "plain", "saved"]);
    expect(saved()).toHaveLength(2);
  });

  it("passes every other save failure through untouched", async () => {
    backend("utf-16le");
    await readTextFile("C:/Conv/Full.md");
    (invoke as Mock).mockRejectedValueOnce("disk full");
    await expect(saveTextFile("C:/Conv/Full.md", "x")).rejects.toBe("disk full");
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("fileIO BOM round-trip (ENC-01)", () => {
  it("strips a UTF-8 BOM on read and restores it on save; BOM-less files stay BOM-less", async () => {
    (invoke as Mock).mockImplementation((cmd: string, args: { path: string }) =>
      cmd === "read_file"
        ? Promise.resolve({ path: args.path, content: args.path.toLowerCase().endsWith("bom.md") ? "\uFEFF---\ntitle: x\n---\n" : "plain" })
        : Promise.resolve(1),
    );
    const bom = await readTextFile<{ content: string }>("C:/Notes/BOM.md");
    expect(bom.content).toBe("---\ntitle: x\n---\n");
    await saveTextFile("c:/notes/bom.md", "edited");
    expect(invoke).toHaveBeenLastCalledWith("save_file", { path: "c:/notes/bom.md", content: "\uFEFFedited" });

    await readTextFile("C:/notes/plain.md");
    await saveTextFile("C:/notes/plain.md", "edited");
    expect(invoke).toHaveBeenLastCalledWith("save_file", { path: "C:/notes/plain.md", content: "edited" });
  });
});

describe("idleWriteToken (EXT-08)", () => {
  it("is null while a save is in flight and changes once it settles, even when it fails", async () => {
    let finish!: (mtime: number) => void;
    let fail!: (err: string) => void;
    (invoke as Mock).mockImplementationOnce(() => new Promise<number>((resolve) => { finish = resolve; }));
    const before = idleWriteToken();
    expect(before).not.toBeNull();
    const saving = saveTextFile("C:/notes/a.md", "x");
    expect(idleWriteToken()).toBeNull();
    finish(5);
    expect(await saving).toBe(5);
    const afterOk = idleWriteToken();
    expect(afterOk).not.toBeNull();
    expect(afterOk).not.toBe(before);

    (invoke as Mock).mockImplementationOnce(() => new Promise<number>((_, reject) => { fail = reject; }));
    const failing = saveTextFile("C:/notes/a.md", "y");
    expect(idleWriteToken()).toBeNull();
    fail("disk full");
    await expect(failing).rejects.toBe("disk full");
    expect(idleWriteToken()).not.toBeNull();
    expect(idleWriteToken()).not.toBe(afterOk);
  });
});

describe("fileIO Android source write-back (#305, ANDR-02)", () => {
  const CACHE_PATH = "/data/user/0/com.paperling/cache/open/a1b2c3d4/tmp.md";
  const NOTES_PATH = "/data/user/0/com.paperling/files/notes/tmp.md";
  const win = window as unknown as {
    PaperlingAndroid?: { syncToSource?: (path: string, text: string, id: string) => void };
    __paperlingOnSyncResult?: (ok: boolean, error: string | null, id: string) => void;
  };

  afterEach(() => {
    delete win.PaperlingAndroid;
    delete win.__paperlingOnSyncResult;
    vi.doUnmock("./platform");
    vi.resetModules();
  });

  it("syncs Android cache files (with BOM) back to source BEFORE calling save_file", async () => {
    const order: string[] = [];
    (invoke as Mock).mockReset().mockImplementation(async (cmd: string) => {
      order.push(cmd);
      if (cmd === "read_file") return { path: CACHE_PATH, content: "\uFEFFold", encoding: "utf-8-bom" };
      return 42;
    });
    win.PaperlingAndroid = {
      syncToSource: (path, text, id) => {
        order.push(`sync:${path}:${text}`);
        win.__paperlingOnSyncResult!(true, null, id);
      },
    };

    await readTextFile(CACHE_PATH);
    await expect(saveTextFile(CACHE_PATH, "new")).resolves.toBe(42);
    expect(order).toEqual(["read_file", `sync:${CACHE_PATH}:\uFEFFnew`, "save_file"]);
  });

  it("rejects before touching save_file or fileHistory when source write-back fails", async () => {
    (fileHistory.record as Mock).mockClear();
    (invoke as Mock).mockReset().mockResolvedValue(42);
    win.PaperlingAndroid = {
      syncToSource: (_path, _text, id) => {
        win.__paperlingOnSyncResult!(false, "This file was opened read-only", id);
      },
    };
    const before = idleWriteToken();
    await expect(saveTextFile(CACHE_PATH, "edited")).rejects.toThrow("This file was opened read-only");
    expect(invoke).not.toHaveBeenCalledWith("save_file", expect.anything());
    expect(fileHistory.record).not.toHaveBeenCalledWith(CACHE_PATH, "edited", "saved");
    expect(idleWriteToken()).not.toBeNull();
    expect(idleWriteToken()).not.toBe(before);
  });

  it("skips syncToSource for private notes files or when skipExternalSync is set", async () => {
    const syncSpy = vi.fn((_p: string, _c: string, id: string) => win.__paperlingOnSyncResult!(true, null, id));
    win.PaperlingAndroid = { syncToSource: syncSpy };
    (invoke as Mock).mockReset().mockResolvedValue(12);

    await saveTextFile(NOTES_PATH, "note");
    await saveTextFile(CACHE_PATH, "downloaded", { skipExternalSync: true });
    expect(syncSpy).not.toHaveBeenCalled();
    expect(saves()).toHaveLength(2);
  });

  it("refuses silently succeeding on mobile when the native sync bridge is unavailable", async () => {
    vi.resetModules();
    vi.doMock("./platform", () => ({ IS_MOBILE: true }));
    const { saveTextFile: saveMobile } = await import("./fileIO");
    (invoke as Mock).mockReset().mockResolvedValue(99);
    await expect(saveMobile(CACHE_PATH, "edited")).rejects.toThrow(/Use Save As/);
    expect(invoke).not.toHaveBeenCalledWith("save_file", expect.anything());
  });

  it("retargets BOM tracking on rename/trash and allows skipping fileHistory for internal probes", async () => {
    const { hadBom, retargetEncodings, readTextFile: rtf } = await import("./fileIO");
    (fileHistory.record as Mock).mockClear();
    (invoke as Mock).mockReset().mockResolvedValue({ path: "C:/BomOld.md", content: "\uFEFFhello", encoding: "utf-8-bom" });

    await rtf("C:/BomOld.md", { recordHistory: false });
    expect(fileHistory.record).not.toHaveBeenCalled();
    expect(hadBom("C:/BomOld.md")).toBe(true);

    retargetEncodings("C:/BomOld.md", "C:/BomNew.md");
    expect(hadBom("C:/BomOld.md")).toBe(false);
    expect(hadBom("C:/BomNew.md")).toBe(true);

    retargetEncodings("C:/BomNew.md", null);
    expect(hadBom("C:/BomNew.md")).toBe(false);
  });
});
