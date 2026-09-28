import { describe, it, expect } from "vitest";
import { findAll, matchLength, expandReplacement, replaceOne, replaceAllMatches, isValidPattern } from "./findReplace";

describe("findAll", () => {
    it("returns no matches for an empty needle", () => {
        expect(findAll("abc", "", false, false)).toEqual([]);
        expect(findAll("abc", "", false, true)).toEqual([]);
    });

    it("finds all plain, non-overlapping matches", () => {
        expect(findAll("the cat sat", "at", false, false)).toEqual([5, 9]);
        // Non-overlapping: "aa" in "aaaa" steps past each hit.
        expect(findAll("aaaa", "aa", false, false)).toEqual([0, 2]);
    });

    it("is case-insensitive by default and case-sensitive when asked", () => {
        expect(findAll("Foo foo FOO", "foo", false, false)).toEqual([0, 4, 8]);
        expect(findAll("Foo foo FOO", "foo", true, false)).toEqual([4]);
    });

    it("finds regex matches", () => {
        expect(findAll("a1 b2 c3", "[a-z]\\d", false, true)).toEqual([0, 3, 6]);
    });

    it("respects the regex case-sensitivity flag", () => {
        expect(findAll("Ab ab AB", "ab", true, true)).toEqual([3]);
        expect(findAll("Ab ab AB", "ab", false, true)).toEqual([0, 3, 6]);
    });

    it("advances past zero-width regex matches instead of looping forever", () => {
        // `x*` matches the empty string at every position (4 in "abc").
        expect(findAll("abc", "x*", false, true)).toEqual([0, 1, 2, 3]);
    });

    it("returns [] for an invalid regex instead of throwing", () => {
        expect(findAll("abc", "(", false, true)).toEqual([]);
    });
});

describe("matchLength", () => {
    it("returns the needle length in plain mode", () => {
        expect(matchLength("hello", 0, "hel", false, false)).toBe(3);
    });

    it("returns the matched length for a regex anchored at the index", () => {
        expect(matchLength("aaa123", 3, "\\d+", false, true)).toBe(3);
    });

    it("returns 0 when the regex does not match at the given index", () => {
        expect(matchLength("aaa123", 0, "\\d+", false, true)).toBe(0);
    });

    it("returns 0 for an invalid regex", () => {
        expect(matchLength("abc", 0, "(", false, true)).toBe(0);
    });
});

describe("expandReplacement", () => {
    const exec = (pattern: string, input: string): RegExpExecArray => {
        const m = new RegExp(pattern).exec(input);
        if (!m) throw new Error("pattern did not match the test input");
        return m;
    };

    it("expands numbered capture groups", () => {
        const m = exec("(\\w+)@(\\w+)", "user@host");
        expect(expandReplacement(m, "$2/$1")).toBe("host/user");
    });

    it("expands $& to the whole match", () => {
        const m = exec("\\d+", "abc123");
        expect(expandReplacement(m, "[$&]")).toBe("[123]");
    });

    it("treats $$ as a literal dollar sign", () => {
        const m = exec("\\d+", "5");
        expect(expandReplacement(m, "$$$&")).toBe("$5");
    });

    it("leaves an out-of-range group reference verbatim", () => {
        const m = exec("(\\d)", "7");
        expect(expandReplacement(m, "$2")).toBe("$2");
    });
});

describe("replaceOne", () => {
    it("replaces a plain match at the given index and positions the caret after it", () => {
        // "the cat sat" → replace "at" at index 5 with "X".
        expect(replaceOne("the cat sat", 5, "at", "X", false, false)).toEqual({
            content: "the cX sat",
            cursor: 6,
        });
    });

    it("expands regex backreferences in the replacement", () => {
        expect(replaceOne("user@host", 0, "(\\w+)@(\\w+)", "$2/$1", false, true)).toEqual({
            content: "host/user",
            cursor: 9,
        });
    });

    it("returns null when the regex does not match at the index", () => {
        expect(replaceOne("abc 123", 0, "\\d+", "#", false, true)).toBeNull();
    });

    it("returns null for an invalid regex", () => {
        expect(replaceOne("abc", 0, "(", "x", false, true)).toBeNull();
    });

    it("returns null for an empty plain query (zero-length match)", () => {
        expect(replaceOne("abc", 0, "", "x", false, false)).toBeNull();
    });
});

describe("replaceAllMatches", () => {
    it("replaces every plain match, keeping the caret near the first one", () => {
        const matches = findAll("the cat sat", "at", false, false); // [5, 9]
        expect(replaceAllMatches("the cat sat", matches, "at", "X", false, false)).toEqual({
            content: "the cX sX",
            cursor: 6,
        });
    });

    it("handles a multi-character replacement that shifts later indices", () => {
        const matches = findAll("a a a", "a", false, false); // [0, 2, 4]
        expect(replaceAllMatches("a a a", matches, "a", "bb", false, false)).toEqual({
            content: "bb bb bb",
            cursor: 2,
        });
    });

    it("uses native regex replacement with backreferences", () => {
        const matches = findAll("a1 b2", "([a-z])(\\d)", false, true); // [0, 3]
        // Cursor uses the replacement template length ("$2$1" → 4), matching the
        // existing behaviour: min(matches[0] + 4, content length).
        expect(replaceAllMatches("a1 b2", matches, "([a-z])(\\d)", "$2$1", false, true)).toEqual({
            content: "1a 2b",
            cursor: 4,
        });
    });

    it("returns null when there are no matches", () => {
        expect(replaceAllMatches("abc", [], "x", "y", false, false)).toBeNull();
    });

    it("returns null for an invalid regex", () => {
        expect(replaceAllMatches("abc", [0], "(", "y", false, true)).toBeNull();
    });
});

describe("isValidPattern", () => {
    it("treats plain text as always valid", () => {
        expect(isValidPattern("(", false)).toBe(true);
        expect(isValidPattern("", false)).toBe(true);
    });

    it("treats an empty regex query as valid (nothing to compile yet)", () => {
        expect(isValidPattern("", true)).toBe(true);
    });

    it("accepts a well-formed regex", () => {
        expect(isValidPattern("\\d+", true)).toBe(true);
    });

    it("rejects an uncompilable regex", () => {
        expect(isValidPattern("(", true)).toBe(false);
        expect(isValidPattern("[", true)).toBe(false);
    });
});
