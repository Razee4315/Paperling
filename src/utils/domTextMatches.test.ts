import { describe, it, expect } from "vitest";
import { collectDomMatches } from "./domTextMatches";

const root = (html: string): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
};

describe("collectDomMatches", () => {
    it("finds every occurrence in document order", () => {
        const el = root("<p>milk</p><p>eggs</p><p>milk</p>");
        const ranges = collectDomMatches(el, "milk", false);
        expect(ranges).toHaveLength(2);
        expect(ranges.map((r) => r.toString())).toEqual(["milk", "milk"]);
    });

    it("finds repeats inside one text node without overlapping", () => {
        const ranges = collectDomMatches(root("<p>aaaa</p>"), "aa", false);
        expect(ranges).toHaveLength(2);
    });

    it("is case-insensitive by default and exact when asked", () => {
        expect(collectDomMatches(root("<p>Milk</p>"), "milk", false)).toHaveLength(1);
        expect(collectDomMatches(root("<p>Milk</p>"), "milk", true)).toHaveLength(0);
    });

    it("returns nothing for an empty query", () => {
        expect(collectDomMatches(root("<p>anything</p>"), "", false)).toEqual([]);
    });

    // A review chunk wraps its removed lines next to Accept/Reject buttons.
    // Matching button labels would both inflate the count and highlight chrome.
    it("skips subtrees matching the skip selectors", () => {
        const el = root(
            '<div class="cm-chunkButtons"><button>Accept item</button></div>' +
            '<div class="cm-deletedLine"><del>keep item</del></div>'
        );

        expect(collectDomMatches(el, "item", false)).toHaveLength(2);

        const scoped = collectDomMatches(el, "item", false, [".cm-chunkButtons"]);
        expect(scoped).toHaveLength(1);
        expect(scoped[0].startContainer.parentElement?.tagName).toBe("DEL");
    });

    it("skips a subtree even when the text node is nested deeper than the match", () => {
        const el = root('<div class="cm-chunkButtons"><span><b>Reject</b></span></div><p>Reject</p>');
        expect(collectDomMatches(el, "Reject", false, [".cm-chunkButtons"])).toHaveLength(1);
    });

    it("does not match across element boundaries (documented limit)", () => {
        // "bold" + "text" are separate nodes, so "boldtext" is not a hit.
        expect(collectDomMatches(root("<p><b>bold</b>text</p>"), "boldtext", false)).toEqual([]);
    });

    it("walks sibling nodes of one line independently", () => {
        // A review line split at a change boundary: two text nodes, one hit each.
        const el = root('<div class="cm-deletedLine"><del>buy <span>milk</span> and milk</del></div>');
        expect(collectDomMatches(el, "milk", false)).toHaveLength(2);
    });
});
