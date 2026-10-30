import { afterEach, describe, expect, it, vi } from "vitest";
import { writeRichClipboard } from "./richClipboard";

afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
});

class FakeItem {
    constructor(public items: Record<string, Blob>) {}
}

describe("writeRichClipboard (COPY-02)", () => {
    it("writes HTML and text flavours together", async () => {
        const write = vi.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
        vi.stubGlobal("ClipboardItem", FakeItem);
        await writeRichClipboard("<b>hi</b>", "**hi**");
        const [[item]] = write.mock.calls[0] as unknown as [[FakeItem]];
        expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    });

    function stubCopyEvent(succeeds: boolean) {
        const setData = vi.fn();
        const execCommand = vi.fn(() => {
            if (!succeeds) return false;
            const event = new Event("copy", { cancelable: true });
            Object.defineProperty(event, "clipboardData", { value: { setData } });
            document.dispatchEvent(event);
            return true;
        });
        Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
        return setData;
    }

    it("falls back to the copy event when a rich write is refused", async () => {
        Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
        vi.stubGlobal("ClipboardItem", FakeItem);
        const setData = stubCopyEvent(true);
        await writeRichClipboard("<b>hi</b>", "**hi**");
        expect(setData).toHaveBeenCalledWith("text/html", "<b>hi</b>");
        expect(setData).toHaveBeenCalledWith("text/plain", "**hi**");
    });

    it("reports failure instead of pretending it copied", async () => {
        stubCopyEvent(false);
        await expect(writeRichClipboard("<b>hi</b>", "**hi**")).rejects.toThrow();
    });
});
