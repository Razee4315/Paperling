import { describe, it, expect } from "vitest";
import { linkAt } from "./editorLinks";

describe("linkAt (NAV-11)", () => {
    it("finds wikilinks, with or without alias and anchor", () => {
        const line = "See [[Ideas]] and [[Journal#Monday|monday]].";
        expect(linkAt(line, 7)).toEqual({ kind: "wikilink", target: "Ideas" });
        expect(linkAt(line, 25)).toEqual({ kind: "wikilink", target: "Journal#Monday" });
        expect(linkAt(line, 1)).toBeNull();
    });

    it("classifies markdown links by target", () => {
        const line = "[site](https://example.com) [note](sub/other.md) [top](#setup) [x](javascript:alert(1))";
        expect(linkAt(line, 2)).toEqual({ kind: "url", target: "https://example.com" });
        expect(linkAt(line, 32)).toEqual({ kind: "relative", target: "sub/other.md" });
        expect(linkAt(line, 52)).toEqual({ kind: "anchor", target: "setup" });
        expect(linkAt(line, 68)).toBeNull();
    });

    it("finds autolinks and bare URLs without trailing punctuation", () => {
        expect(linkAt("go to <https://a.b/c> now", 10)).toEqual({ kind: "url", target: "https://a.b/c" });
        expect(linkAt("visit https://example.com/page.", 12)).toEqual({ kind: "url", target: "https://example.com/page" });
        expect(linkAt("or www.example.com today", 6)).toEqual({ kind: "url", target: "https://www.example.com" });
    });

    it("handles image links like links", () => {
        expect(linkAt("![diagram](img/d.png)", 3)).toEqual({ kind: "relative", target: "img/d.png" });
    });
});
