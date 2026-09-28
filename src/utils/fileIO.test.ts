import { describe, expect, it, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, saveTextFile } from "./fileIO";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
