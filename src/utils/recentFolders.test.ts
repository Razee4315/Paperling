import { beforeEach, describe, expect, it } from "vitest";
import { filterEntries } from "../components/FileExplorer";
import { addRecentFolder, getRecentFolders, removeRecentFolder } from "./persistence";

beforeEach(() => localStorage.clear());

describe("recent folders (FILES-11)", () => {
    it("lists newest first without duplicates", () => {
        addRecentFolder("/a");
        addRecentFolder("/b");
        addRecentFolder("/a");
        expect(getRecentFolders()).toEqual(["/a", "/b"]);
    });
    it("keeps the list short", () => {
        for (let i = 0; i < 12; i++) addRecentFolder(`/f${i}`);
        expect(getRecentFolders()).toHaveLength(8);
        expect(getRecentFolders()[0]).toBe("/f11");
    });
    it("drops a folder", () => {
        addRecentFolder("/a");
        removeRecentFolder("/a");
        expect(getRecentFolders()).toEqual([]);
    });
    it("survives junk in storage", () => {
        localStorage.setItem("paperling:recentFolders", JSON.stringify({ not: "a list" }));
        expect(getRecentFolders()).toEqual([]);
        localStorage.setItem("paperling:recentFolders", JSON.stringify(["/ok", 3, null]));
        expect(getRecentFolders()).toEqual(["/ok"]);
    });
});

describe("filterEntries (FILES-12)", () => {
    const entries = [{ name: "Ideas.md" }, { name: "Journal.md" }, { name: "projects" }];
    it("matches anywhere in the name, ignoring case", () => {
        expect(filterEntries(entries, "JOUR")).toEqual([{ name: "Journal.md" }]);
        expect(filterEntries(entries, ".md")).toHaveLength(2);
    });
    it("shows everything for an empty filter", () => {
        expect(filterEntries(entries, "   ")).toBe(entries);
    });
    it("can match nothing", () => {
        expect(filterEntries(entries, "zzz")).toEqual([]);
    });
});
