import { describe, expect, it } from "vitest";
import { decideDiskChange } from "./diskGuard";

describe("decideDiskChange", () => {
    it("lets mtime decide when both sides are usable", () => {
        expect(decideDiskChange(100, 200)).toEqual({ kind: "changed", diskMtime: 200 });
        expect(decideDiskChange(100, 100)).toEqual({ kind: "unchanged" });
        // An older on-disk mtime (sync tool restored a version) is not "changed":
        // the guard never fires on it, matching the pre-EXT-10 comparison.
        expect(decideDiskChange(200, 100)).toEqual({ kind: "unchanged" });
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
