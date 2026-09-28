// Regression tests for the find-bar focus steal (Reddit: Individual-Diet-5051).
// The auto-jump that follows each query keystroke used to call view.focus(),
// moving DOM focus into the CodeMirror document ~100ms (one debounce) after the
// first character — so the user's next keystroke overwrote the matched text.
// These tests mount the real CodeEditor and assert focus stays in the find
// input across the debounce and across Enter-to-cycle.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen, cleanup } from "@testing-library/react";
import { CodeEditor } from "./CodeEditor";
import { installCodeMirrorDomPolyfills } from "../test/codemirrorDom";

beforeAll(installCodeMirrorDomPolyfills);

// RTL's automatic cleanup needs vitest `globals: true`, which this repo doesn't
// enable — without this the second test finds two mounted editors.
afterEach(cleanup);

const DEBOUNCE_MS = 100;

async function mountEditorWithFindOpen(onChange = vi.fn()) {
    const utils = render(<CodeEditor content="hello world hello" onChange={onChange} />);
    const content = await waitFor(() => {
        const el = utils.container.querySelector<HTMLElement>(".cm-content");
        expect(el).toBeTruthy();
        return el!;
    });
    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    const input = await screen.findByLabelText<HTMLInputElement>("Find text");
    input.focus();
    return { ...utils, input, content, onChange };
}

describe("FindBar focus ownership", () => {
    it("keeps focus in the find input after typing a character and passing the debounce", async () => {
        const { input, onChange } = await mountEditorWithFindOpen();
        expect(document.activeElement).toBe(input);

        fireEvent.change(input, { target: { value: "h" } });
        // The counter renders in the same commit whose effects run the
        // auto-jump, so once it shows, the jump (the old focus thief) has fired.
        await screen.findByText("1 of 2", undefined, { timeout: DEBOUNCE_MS * 20 });

        expect(document.activeElement).toBe(input);
        // The document itself must never change from find-as-you-type.
        expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps focus in the find input when Enter cycles to the next match", async () => {
        const { input, onChange } = await mountEditorWithFindOpen();

        fireEvent.change(input, { target: { value: "hello" } });
        await screen.findByText("1 of 2", undefined, { timeout: DEBOUNCE_MS * 20 });

        fireEvent.keyDown(input, { key: "Enter" });
        // "2 of 2" proves the cycle actually advanced (and re-ran the jump).
        await screen.findByText("2 of 2", undefined, { timeout: DEBOUNCE_MS * 20 });

        expect(document.activeElement).toBe(input);
        expect(onChange).not.toHaveBeenCalled();
    });
});
