import { describe, expect, it } from "vitest";
import { hasEmojiShortcode, loadEmojiNames, matchEmojiPrefix, rankEmoji, rehypeEmoji, replaceShortcodes } from "./emoji";

const names = { rocket: "🚀", smile: "😄", smiley: "😃", "+1": "👍" };

describe("replaceShortcodes (EMOJI-01)", () => {
    it("replaces known names", () => {
        expect(replaceShortcodes("Launch :rocket: now :+1:", names)).toBe("Launch 🚀 now 👍");
    });
    it("leaves unknown names and times alone", () => {
        expect(replaceShortcodes("at 12:30:45 and :nope:", names)).toBe("at 12:30:45 and :nope:");
    });
    it("ignores names from the object prototype", () => {
        expect(replaceShortcodes(":constructor: :toString:", names)).toBe(":constructor: :toString:");
    });
});

describe("rehypeEmoji", () => {
    const text = (value: string) => ({ type: "text", value });
    const el = (tagName: string, children: object[], properties = {}) => ({ type: "element", tagName, properties, children });

    it("changes prose but not code, or a heading's id", () => {
        const tree = {
            type: "root",
            children: [
                el("h2", [text(":rocket: Launch")], { id: "rocket-launch" }),
                el("p", [text("hi "), el("code", [text(":rocket:")])]),
                el("pre", [el("code", [text(":smile:")])]),
                el("span", [text(":smile:")], { className: ["katex"] }),
            ],
        };
        rehypeEmoji({ names })(tree);
        const [heading, para, pre, math] = tree.children as ReturnType<typeof el>[];
        expect(heading.children[0]).toEqual(text("🚀 Launch"));
        expect(heading.properties).toEqual({ id: "rocket-launch" });
        expect(((para.children[1] as ReturnType<typeof el>).children[0])).toEqual(text(":rocket:"));
        expect(((pre.children[0] as ReturnType<typeof el>).children[0])).toEqual(text(":smile:"));
        expect(math.children[0]).toEqual(text(":smile:"));
    });
});

describe("emoji completion", () => {
    it("opens after a word boundary with two letters", () => {
        expect(matchEmojiPrefix("Launch :ro")).toEqual({ from: 7, query: "ro" });
        expect(matchEmojiPrefix(":sm")).toEqual({ from: 0, query: "sm" });
        expect(matchEmojiPrefix("**:SM")).toEqual({ from: 2, query: "sm" });
    });
    it("stays quiet in times, URLs and smileys", () => {
        for (const text of ["at 12:30", "https:ab", "note:ab", ":)", ":a", "plain"]) {
            expect(matchEmojiPrefix(text)).toBeNull();
        }
    });
    it("ranks prefix matches first", () => {
        expect(rankEmoji(names, "smi").map((e) => e.name)).toEqual(["smile", "smiley"]);
        expect(rankEmoji(names, "rock")[0]).toEqual({ name: "rocket", emoji: "🚀" });
    });
});

describe("the name table", () => {
    it("detects shortcodes cheaply", () => {
        expect(hasEmojiShortcode("hi :wave:")).toBe(true);
        expect(hasEmojiShortcode("hi: there")).toBe(false);
    });
    it("loads real data", async () => {
        const table = await loadEmojiNames();
        expect(table.rocket).toBe("🚀");
        expect(table["+1"]).toBe("👍");
    });
});
