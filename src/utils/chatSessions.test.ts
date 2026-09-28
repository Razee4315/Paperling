import { describe, it, expect } from "vitest";
import {
    deriveTitle,
    pruneSessions,
    upsertSession,
    removeSession,
    sanitizeSessions,
    makeSessionId,
    MAX_SESSIONS,
    MAX_TOTAL_CHARS,
    type ChatSession,
} from "./chatSessions";

const session = (over: Partial<ChatSession> = {}): ChatSession => ({
    id: "a",
    title: "t",
    updatedAt: 1,
    messages: [{ role: "user", content: "hi" }],
    ...over,
});

describe("deriveTitle", () => {
    it("uses the first user message", () => {
        expect(deriveTitle([
            { role: "user", content: "Summarise this note" },
            { role: "assistant", content: "Sure" },
        ])).toBe("Summarise this note");
    });

    it("ignores a leading assistant message", () => {
        expect(deriveTitle([
            { role: "assistant", content: "Hello there" },
            { role: "user", content: "the real question" },
        ])).toBe("the real question");
    });

    it("collapses whitespace so a pasted prompt stays one line", () => {
        expect(deriveTitle([{ role: "user", content: "  line one\n\n\tline two  " }])).toBe("line one line two");
    });

    it("falls back when there is nothing to name it after", () => {
        expect(deriveTitle([])).toBe("New chat");
        expect(deriveTitle([{ role: "user", content: "   " }])).toBe("New chat");
        expect(deriveTitle([{ role: "assistant", content: "only me" }])).toBe("New chat");
    });

    it("truncates long titles on a word boundary", () => {
        const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo";
        const title = deriveTitle([{ role: "user", content: words }]);
        expect(title.endsWith("…")).toBe(true);
        expect(title.length).toBeLessThanOrEqual(62);
        // Broke on a space, so no word is cut in half.
        expect(title.slice(0, -1)).toBe(title.slice(0, -1).trimEnd());
        expect(words.startsWith(title.slice(0, -1))).toBe(true);
    });

    it("hard-truncates when there is no usable word boundary", () => {
        const title = deriveTitle([{ role: "user", content: "x".repeat(100) }]);
        expect(title).toBe("x".repeat(60) + "…");
    });
});

describe("pruneSessions", () => {
    it("orders newest first", () => {
        const out = pruneSessions([
            session({ id: "old", updatedAt: 1 }),
            session({ id: "new", updatedAt: 3 }),
            session({ id: "mid", updatedAt: 2 }),
        ]);
        expect(out.map((s) => s.id)).toEqual(["new", "mid", "old"]);
    });

    it("caps the session count, dropping the oldest", () => {
        const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) =>
            session({ id: `s${i}`, updatedAt: i })
        );
        const out = pruneSessions(many);
        expect(out).toHaveLength(MAX_SESSIONS);
        // The five oldest are gone.
        expect(out.some((s) => s.id === "s0")).toBe(false);
        expect(out[0].id).toBe(`s${MAX_SESSIONS + 4}`);
    });

    it("caps total characters, dropping the oldest", () => {
        const big = (id: string, updatedAt: number) =>
            session({ id, updatedAt, title: "", messages: [{ role: "user", content: "x".repeat(80_000) }] });

        const out = pruneSessions([big("a", 1), big("b", 2), big("c", 3)]);

        // 3 x 80k exceeds the budget, so the oldest is evicted.
        expect(out.map((s) => s.id)).toEqual(["c", "b"]);
    });

    it("always keeps the newest session even if it alone busts the budget", () => {
        const huge = session({
            id: "huge",
            updatedAt: 9,
            title: "",
            messages: [{ role: "user", content: "x".repeat(MAX_TOTAL_CHARS + 5000) }],
        });
        const out = pruneSessions([session({ id: "small", updatedAt: 1 }), huge]);
        expect(out.map((s) => s.id)).toEqual(["huge"]);
    });

    it("handles an empty list", () => {
        expect(pruneSessions([])).toEqual([]);
    });

    it("does not mutate its input", () => {
        const input = [session({ id: "a", updatedAt: 1 }), session({ id: "b", updatedAt: 2 })];
        const copy = [...input];
        pruneSessions(input);
        expect(input).toEqual(copy);
    });
});

describe("upsertSession", () => {
    it("adds a new session", () => {
        const out = upsertSession([], session({ id: "a" }));
        expect(out.map((s) => s.id)).toEqual(["a"]);
    });

    it("replaces an existing session rather than duplicating it", () => {
        const before = [session({ id: "a", updatedAt: 1, title: "old" })];
        const out = upsertSession(before, session({ id: "a", updatedAt: 2, title: "new" }));
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe("new");
    });

    it("moves the updated session to the front", () => {
        const before = [
            session({ id: "a", updatedAt: 1 }),
            session({ id: "b", updatedAt: 2 }),
        ];
        const out = upsertSession(before, session({ id: "a", updatedAt: 5 }));
        expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    });

    it("does not store an empty chat, and removes one that became empty", () => {
        expect(upsertSession([], session({ id: "a", messages: [] }))).toEqual([]);

        const before = [session({ id: "a", messages: [{ role: "user", content: "hi" }] })];
        expect(upsertSession(before, session({ id: "a", messages: [] }))).toEqual([]);
    });
});

describe("removeSession", () => {
    it("removes by id and leaves the rest untouched", () => {
        const before = [session({ id: "a" }), session({ id: "b" })];
        expect(removeSession(before, "a").map((s) => s.id)).toEqual(["b"]);
    });

    it("is a no-op for an unknown id", () => {
        const before = [session({ id: "a" })];
        expect(removeSession(before, "zzz")).toHaveLength(1);
    });
});

describe("sanitizeSessions", () => {
    it("accepts a well-formed list", () => {
        const out = sanitizeSessions([
            { id: "a", title: "T", updatedAt: 5, messages: [{ role: "user", content: "hi" }] },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe("T");
    });

    it("returns empty for anything that is not an array", () => {
        expect(sanitizeSessions(null)).toEqual([]);
        expect(sanitizeSessions(undefined)).toEqual([]);
        expect(sanitizeSessions("nope")).toEqual([]);
        expect(sanitizeSessions({ id: "a" })).toEqual([]);
    });

    it("drops entries missing an id or a message array", () => {
        const out = sanitizeSessions([
            { title: "no id", messages: [] },
            { id: "", messages: [] },
            { id: "b", messages: "not an array" },
            { id: "ok", messages: [{ role: "user", content: "hi" }] },
        ]);
        expect(out.map((s) => s.id)).toEqual(["ok"]);
    });

    it("drops malformed messages but keeps the session", () => {
        const out = sanitizeSessions([
            {
                id: "a",
                title: "T",
                updatedAt: 1,
                messages: [
                    { role: "user", content: "keep" },
                    { role: "system", content: "wrong role" },
                    { role: "assistant", content: 42 },
                    null,
                    { role: "assistant", content: "keep too" },
                ],
            },
        ]);
        expect(out[0].messages).toEqual([
            { role: "user", content: "keep" },
            { role: "assistant", content: "keep too" },
        ]);
    });

    it("recovers a missing title and timestamp", () => {
        const out = sanitizeSessions([{ id: "a", messages: [{ role: "user", content: "derive me" }] }]);
        expect(out[0].title).toBe("derive me");
        expect(out[0].updatedAt).toBe(0);
    });

    it("prunes as part of sanitizing", () => {
        const many = Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => ({
            id: `s${i}`,
            title: "t",
            updatedAt: i,
            messages: [{ role: "user", content: "hi" }],
        }));
        expect(sanitizeSessions(many)).toHaveLength(MAX_SESSIONS);
    });
});

describe("makeSessionId", () => {
    it("returns distinct non-empty ids", () => {
        const a = makeSessionId();
        const b = makeSessionId();
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        expect(a).not.toBe(b);
    });
});
