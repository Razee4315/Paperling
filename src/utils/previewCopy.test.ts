import { afterEach, describe, expect, it } from "vitest";
import { selectionFragment, writeCleanSelection } from "./previewCopy";

function mount(html: string) {
    const root = document.createElement("div");
    root.className = "markdown-body";
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}
afterEach(() => { document.body.innerHTML = ""; });

const HEADING = '<h2 id="headline"><span>Headline</span><button><span class="material-symbols-outlined">link</span></button></h2>';

describe("preview copy. COPY-01", () => {
    it("drops the heading permalink icon text and keeps the heading", () => {
        const root = mount(HEADING + "<ul><li><strong>Cap-04.</strong> Every model closed.</li></ul>");
        const range = document.createRange();
        range.setStart(root, 0);
        range.setEnd(root, root.childNodes.length);
        const html = selectionFragment(range, root).innerHTML;
        expect(html).not.toContain("link<");
        expect(html).not.toContain("<button");
        expect(html).toContain("<h2");
        expect(html).toContain("<strong>Cap-04.</strong>");
    });

    it("wraps a selection inside one list item in its list", () => {
        const root = mount("<ul><li>alpha beta</li><li>gamma</li></ul>");
        const text = root.querySelector("li")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 5);
        expect(selectionFragment(range, root).innerHTML).toBe("<ul><li>alpha</li></ul>");
    });

    it("writes clean html and text, and leaves selections outside the preview alone", () => {
        const root = mount(HEADING);
        const outside = document.createElement("p");
        outside.textContent = "elsewhere";
        document.body.appendChild(outside);
        const data = new Map<string, string>();
        const transfer = { setData: (t: string, v: string) => data.set(t, v) } as unknown as DataTransfer;
        const sel = window.getSelection()!;

        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(root);
        sel.addRange(range);
        expect(writeCleanSelection(sel, root, transfer)).toBe(true);
        expect(data.get("text/plain")).toBe("Headline");
        expect(data.get("text/html")).toContain("Headline");

        sel.removeAllRanges();
        const away = document.createRange();
        away.selectNodeContents(outside);
        sel.addRange(away);
        expect(writeCleanSelection(sel, root, transfer)).toBe(false);
    });
});
