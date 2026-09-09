import { describe, it, expect, beforeEach } from "vitest";
import {
    getRecentFiles, addRecentFile, removeRecentFile, clearRecentFiles,
    getSplitRatio, setSplitRatio,
    getAIConfig, setAIConfig,
    getWordWrap,
    migrateLegacyKeys, getLastFile,
    getOpenInReader, setOpenInReader,
    getZenMode, setZenMode,
    getAIHistoryTurns, setAIHistoryTurns, AI_HISTORY_TURNS_DEFAULT, AI_HISTORY_TURNS_MAX,
} from "./persistence";

beforeEach(() => localStorage.clear());

describe("marklite -> paperling key migration", () => {
    it("copies legacy values to the new prefix and removes the originals", () => {
        localStorage.setItem("marklite:lastFile", JSON.stringify("C:/notes/old.md"));
        localStorage.setItem("marklite:wordWrap", JSON.stringify(false));
        migrateLegacyKeys();
        expect(getLastFile()).toBe("C:/notes/old.md");
        expect(getWordWrap()).toBe(false);
        expect(localStorage.getItem("marklite:lastFile")).toBeNull();
        expect(localStorage.getItem("marklite:wordWrap")).toBeNull();
    });

    it("never overwrites an existing paperling value", () => {
        localStorage.setItem("paperling:lastFile", JSON.stringify("C:/notes/new.md"));
        localStorage.setItem("marklite:lastFile", JSON.stringify("C:/notes/old.md"));
        migrateLegacyKeys();
        expect(getLastFile()).toBe("C:/notes/new.md");
    });
});

describe("recent files", () => {
    it("adds most-recent first and de-duplicates by path", () => {
        addRecentFile("/a.md", "a");
        addRecentFile("/b.md", "b");
        addRecentFile("/a.md", "a"); // re-open a -> moves to front
        const list = getRecentFiles();
        expect(list.map((f) => f.path)).toEqual(["/a.md", "/b.md"]);
    });

    it("caps the list at 25 entries", () => {
        for (let i = 0; i < 30; i++) addRecentFile(`/f${i}.md`, `f${i}`);
        expect(getRecentFiles()).toHaveLength(25);
    });

    it("removes and clears", () => {
        addRecentFile("/a.md", "a");
        addRecentFile("/b.md", "b");
        removeRecentFile("/a.md");
        expect(getRecentFiles().map((f) => f.path)).toEqual(["/b.md"]);
        clearRecentFiles();
        expect(getRecentFiles()).toEqual([]);
    });
});

describe("open in reader", () => {
    it("defaults off and round-trips", () => {
        expect(getOpenInReader()).toBe(false);
        setOpenInReader(true);
        expect(getOpenInReader()).toBe(true);
    });
    it("treats a malformed stored value as the default", () => {
        localStorage.setItem("paperling:openInReader", "{not json");
        expect(getOpenInReader()).toBe(false);
    });
});

describe("zen mode", () => {
    it("defaults off and round-trips", () => {
        expect(getZenMode()).toBe(false);
        setZenMode(true);
        expect(getZenMode()).toBe(true);
    });
    it("treats a malformed stored value as the default", () => {
        localStorage.setItem("paperling:zenMode", "{not json");
        expect(getZenMode()).toBe(false);
    });
});

describe("split ratio", () => {
    it("defaults to 0.5", () => {
        expect(getSplitRatio()).toBe(0.5);
    });
    it("persists a valid value and rejects out-of-range", () => {
        setSplitRatio(0.3);
        expect(getSplitRatio()).toBe(0.3);
        setSplitRatio(0.99); // out of (0.15, 0.85) -> falls back to 0.5
        expect(getSplitRatio()).toBe(0.5);
    });
});

describe("AI config", () => {
    it("round-trips endpoint and model via localStorage", () => {
        setAIConfig({ endpoint: "https://x/v1/chat/completions", model: "m", apiKey: "" });
        const cfg = getAIConfig();
        expect(cfg.endpoint).toBe("https://x/v1/chat/completions");
        expect(cfg.model).toBe("m");
    });
    it("mirrors the API key into the in-memory cache synchronously", () => {
        // The key is keychain-backed (SECURITY-01); setAIConfig updates a sync
        // cache that getAIConfig reads, so the value is available immediately
        // even though the keychain write happens asynchronously.
        setAIConfig({ endpoint: "e", model: "m", apiKey: "secret" });
        expect(getAIConfig().apiKey).toBe("secret");
    });
    it("reports empty endpoint/model when unset", () => {
        setAIConfig({ endpoint: "", model: "", apiKey: "" });
        const cfg = getAIConfig();
        expect(cfg.endpoint).toBe("");
        expect(cfg.model).toBe("");
    });
});

describe("defaults", () => {
    it("word wrap defaults to true", () => {
        expect(getWordWrap()).toBe(true);
    });
});

describe("AI chat history depth", () => {
    it("defaults to 8 turns", () => {
        expect(getAIHistoryTurns()).toBe(AI_HISTORY_TURNS_DEFAULT);
    });
    it("round-trips a valid value", () => {
        setAIHistoryTurns(3);
        expect(getAIHistoryTurns()).toBe(3);
        setAIHistoryTurns(0);
        expect(getAIHistoryTurns()).toBe(0);
    });
    it("clamps out-of-range and rounds fractional values", () => {
        setAIHistoryTurns(999);
        expect(getAIHistoryTurns()).toBe(AI_HISTORY_TURNS_MAX);
        setAIHistoryTurns(-4);
        expect(getAIHistoryTurns()).toBe(0);
        setAIHistoryTurns(2.6);
        expect(getAIHistoryTurns()).toBe(3);
    });
    it("falls back to the default on a malformed stored value", () => {
        localStorage.setItem("paperling:aiHistoryTurns", JSON.stringify("lots"));
        expect(getAIHistoryTurns()).toBe(AI_HISTORY_TURNS_DEFAULT);
    });
});
