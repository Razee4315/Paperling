import { describe, expect, it } from "vitest";
import { replaceLiteral } from "./GlobalSearch";

describe("replace in files matcher (GS-04/05)", () => {
  it("replaces literally, honoring case and whole-word, and counts what it replaced", () => {
    expect(replaceLiteral("Cat cat concat (1+1)", "cat", "dog", false)).toEqual({ text: "dog dog condog (1+1)", count: 3 });
    expect(replaceLiteral("Cat cat concat", "cat", "dog", true)).toEqual({ text: "Cat dog condog", count: 2 });
    expect(replaceLiteral("cat concat café_cat écat", "cat", "dog", false, true)).toEqual({ text: "dog concat café_cat écat", count: 1 });
    expect(replaceLiteral("a (1+1) b", "(1+1)", "", false)).toEqual({ text: "a  b", count: 1 });
  });
});
