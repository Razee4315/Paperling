import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { highlightRemovedMatch, clearRemovedHighlight } from "./reviewFindHighlight";

// jsdom has no CSS Custom Highlight API, so stand one up to observe what the
// module registers. The real webviews (WebView2 / WKWebView / WebKitGTK) have it.
class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
        this.ranges = ranges;
    }
}

let registry: Map<string, FakeHighlight>;

const installHighlightApi = () => {
    registry = new Map();
    (globalThis as Record<string, unknown>).Highlight = FakeHighlight;
    (globalThis as unknown as { CSS: unknown }).CSS = { highlights: registry };
};

const removeHighlightApi = () => {
    delete (globalThis as Record<string, unknown>).Highlight;
    delete (globalThis as Record<string, unknown>).CSS;
};

/** A stand-in for @codemirror/merge's rendered `.cm-deletedChunk`. */
const chunk = (lines: string[], withButtons = true): HTMLElement => {
    const el = document.createElement("div");
    el.className = "cm-deletedChunk";
    if (withButtons) {
        el.innerHTML = '<div class="cm-chunkButtons"><button>Accept</button><button>Reject</button></div>';
    }
    for (const line of lines) {
        const div = document.createElement("div");
        div.className = "cm-deletedLine";
        div.innerHTML = `<del>${line}</del>`;
        el.appendChild(div);
    }
    return el;
};

const painted = () => registry.get("paperling-find-removed");

beforeEach(installHighlightApi);
afterEach(removeHighlightApi);

describe("highlightRemovedMatch", () => {
    it("paints the requested occurrence", () => {
        const ok = highlightRemovedMatch(chunk(["buy milk", "buy milk"]), "milk", false, 1);
        expect(ok).toBe(true);
        expect(painted()?.ranges).toHaveLength(1);
        expect(painted()?.ranges[0].toString()).toBe("milk");
    });

    it("distinguishes the first occurrence from the second", () => {
        const el = chunk(["alpha", "beta alpha"]);
        highlightRemovedMatch(el, "alpha", false, 0);
        const first = painted()?.ranges[0].startContainer;
        highlightRemovedMatch(el, "alpha", false, 1);
        const second = painted()?.ranges[0].startContainer;
        expect(first).not.toBe(second);
    });

    it("ignores the Accept/Reject buttons", () => {
        // "Accept" appears only in the chunk chrome, so there is nothing to paint.
        expect(highlightRemovedMatch(chunk(["nothing here"]), "Accept", false, 0)).toBe(false);
        expect(painted()).toBeUndefined();
    });

    it("does not count button text when picking the ordinal", () => {
        // Without the skip, "e" inside "Accept"/"Reject" would shift every ordinal.
        const ok = highlightRemovedMatch(chunk(["zebra"]), "e", false, 0);
        expect(ok).toBe(true);
        expect(painted()?.ranges[0].startContainer.parentElement?.tagName).toBe("DEL");
    });

    it("refuses a multi-line query rather than paint the wrong hit", () => {
        expect(highlightRemovedMatch(chunk(["a", "b"]), "a\nb", false, 0)).toBe(false);
    });

    it("paints nothing when the model saw more occurrences than the DOM has", () => {
        // ordinal 3 does not exist here; blindly indexing would throw or mispaint.
        expect(highlightRemovedMatch(chunk(["one milk"]), "milk", false, 3)).toBe(false);
        expect(painted()).toBeUndefined();
    });

    it("is a no-op with no element, no query, or no Highlight API", () => {
        expect(highlightRemovedMatch(null, "x", false, 0)).toBe(false);
        expect(highlightRemovedMatch(chunk(["x"]), "", false, 0)).toBe(false);

        removeHighlightApi();
        expect(highlightRemovedMatch(chunk(["x"]), "x", false, 0)).toBe(false);
        installHighlightApi();
    });

    it("honours case sensitivity", () => {
        expect(highlightRemovedMatch(chunk(["Milk"]), "milk", true, 0)).toBe(false);
        expect(highlightRemovedMatch(chunk(["Milk"]), "milk", false, 0)).toBe(true);
    });

    it("clears a previous highlight on every call, including failed ones", () => {
        expect(highlightRemovedMatch(chunk(["milk"]), "milk", false, 0)).toBe(true);
        expect(painted()).toBeDefined();

        // A subsequent miss must not leave the old emphasis behind.
        expect(highlightRemovedMatch(chunk(["milk"]), "absent", false, 0)).toBe(false);
        expect(painted()).toBeUndefined();
    });

    it("clearRemovedHighlight removes the registration", () => {
        highlightRemovedMatch(chunk(["milk"]), "milk", false, 0);
        clearRemovedHighlight();
        expect(painted()).toBeUndefined();
    });
});
