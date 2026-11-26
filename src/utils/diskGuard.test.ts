import { describe, expect, it } from "vitest";
import { decideDiskChange } from "./diskGuard";

describe("decideDiskChange", () => {
    it("lets mtime decide when equal or newer, and falls back to compare on mtime rollback (EXT-13)", () => {
        expect(decideDiskChange(100, 200)).toEqual({ kind: "changed", diskMtime: 200 });
        expect(decideDiskChange(100, 100)).toEqual({ kind: "unchanged" });
        // An older on-disk mtime (git checkout / cloud rollback) verifies content
        // before deciding so an external rollback isn't silently overwritten.
        expect(decideDiskChange(200, 100)).toEqual({ kind: "compare" });
    });

    it("falls back to a content comparison when the known mtime is 0", () => {
        // A restored or freshly-opened buffer whose baseline mtime never came
        // back must NOT treat every stat as "unchanged" — that was the silent
        // autosave overwrite. EXT-10.
        expect(decideDiskChange(0, 200)).toEqual({ kind: "compare" });
    });

    it("falls back to a content comparison when the disk mtime is 0", () => {
        // Pre-epoch clock / stat failure: an on-disk 0 can't prove anything.
        expect(decideDiskChange(100, 0)).toEqual({ kind: "compare" });
    });

    it("falls back to a content comparison when neither side is usable", () => {
        expect(decideDiskChange(0, 0)).toEqual({ kind: "compare" });
    });
});
