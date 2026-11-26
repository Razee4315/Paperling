import { describe, it, expect } from "vitest";
import { matchOpenTabForWikilink } from "./wikilinkAnchor";

describe("matchOpenTabForWikilink (WIKI-02)", () => {
    const tabs = [
        { filePath: null },
        { filePath: "C:\\Vault\\Welcome.md" },
        { filePath: "C:\\Vault\\Welcome2.md" },
        { filePath: "C:\\Vault\\Projects\\Roadmap.markdown" },
    ];

    it("resolves bare note names against open parent tabs", () => {
        expect(matchOpenTabForWikilink(tabs, "Welcome")).toBe("C:\\Vault\\Welcome.md");
        expect(matchOpenTabForWikilink(tabs, "welcome.md")).toBe("C:\\Vault\\Welcome.md");
        expect(matchOpenTabForWikilink(tabs, "Roadmap")).toBe("C:\\Vault\\Projects\\Roadmap.markdown");
    });

    it("resolves subfolder relative paths against open tabs", () => {
        expect(matchOpenTabForWikilink(tabs, "Projects/Roadmap")).toBe("C:\\Vault\\Projects\\Roadmap.markdown");
        expect(matchOpenTabForWikilink(tabs, "projects\\roadmap.markdown")).toBe("C:\\Vault\\Projects\\Roadmap.markdown");
    });

    it("ignores partial substring matches and empty targets", () => {
        expect(matchOpenTabForWikilink(tabs, "Welc")).toBeNull();
        expect(matchOpenTabForWikilink(tabs, "")).toBeNull();
        expect(matchOpenTabForWikilink(tabs, "Missing")).toBeNull();
    });
});
