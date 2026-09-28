import { describe, it, expect } from "vitest";
import { matchWikilinkPrefix, rankFileNames, toWikiName } from "./wikilinkComplete";

describe("matchWikilinkPrefix", () => {
  it("matches an open [[ with the typed query", () => {
    expect(matchWikilinkPrefix("see [[Foo")).toEqual({ from: 6, query: "Foo" });
  });

  it("matches an empty target right after [[", () => {
    expect(matchWikilinkPrefix("text [[")).toEqual({ from: 7, query: "" });
  });

  it("returns null when there is no open [[", () => {
    expect(matchWikilinkPrefix("just some text")).toBeNull();
    expect(matchWikilinkPrefix("a [ single bracket")).toBeNull();
  });

  it("returns null once the link is closed", () => {
    expect(matchWikilinkPrefix("[[Foo]] and more")).toBeNull();
  });

  it("does not match across a ] or newline", () => {
    expect(matchWikilinkPrefix("[[Foo] bar")).toBeNull();
  });

  it("stops completing once an alias pipe is typed", () => {
    expect(matchWikilinkPrefix("[[Foo|al")).toBeNull();
  });

  it("uses the last open [[ on the line", () => {
    expect(matchWikilinkPrefix("[[Done]] then [[Bar")).toEqual({ from: 16, query: "Bar" });
  });
});

describe("rankFileNames", () => {
  const names = ["Index", "Inbox", "Project Ideas", "ideas-archive", "Notes"];

  it("returns everything for an empty query", () => {
    expect(rankFileNames(names, "")).toHaveLength(5);
  });

  it("filters case-insensitively by substring", () => {
    expect(rankFileNames(names, "idea")).toEqual(["ideas-archive", "Project Ideas"]);
  });

  it("ranks prefix matches above mid-string matches", () => {
    const r = rankFileNames(["my-inbox", "Inbox"], "inbox");
    expect(r[0]).toBe("Inbox"); // prefix beats mid-string
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 100 }, (_, i) => `note-${i}`);
    expect(rankFileNames(many, "note", 10)).toHaveLength(10);
  });

  it("returns nothing when nothing matches", () => {
    expect(rankFileNames(names, "zzz")).toEqual([]);
  });
});

describe("toWikiName", () => {
  it("strips .md and .markdown", () => {
    expect(toWikiName("Foo.md")).toBe("Foo");
    expect(toWikiName("Bar.markdown")).toBe("Bar");
    expect(toWikiName("no-ext")).toBe("no-ext");
  });
});
