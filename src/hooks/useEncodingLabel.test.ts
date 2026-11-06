import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEncodingLabel } from "./useEncodingLabel";
import { readTextFile, saveTextFile } from "../utils/fileIO";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

afterEach(cleanup);

describe("useEncodingLabel (ENC-05)", () => {
  it("follows the file's encoding, including a conversion to UTF-8", async () => {
    (invoke as Mock).mockImplementation(async (cmd: string, args: { path: string; encoding?: string }) => {
      if (cmd === "read_file") return { path: args.path, content: "x", encoding: "windows-1252" };
      if (cmd === "get_file_info") return { modified: 1 };
      if (args.encoding === "windows-1252") throw "Unrepresentable text: windows-1252 cannot store U+4E2D";
      return 7;
    });
    (ask as Mock).mockResolvedValue(true);

    const { result } = renderHook(() => useEncodingLabel("C:/Hook/legacy.md"));
    expect(result.current).toBeNull();

    await act(() => readTextFile("C:/Hook/legacy.md"));
    expect(result.current).toBe("Windows-1252");

    await act(() => saveTextFile("C:/Hook/legacy.md", "中"));
    expect(result.current).toBeNull();
  });
});
