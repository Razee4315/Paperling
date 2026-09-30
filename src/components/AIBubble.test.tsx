import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AIBubble } from "./AIBubble";
import { runAIAction } from "../utils/aiAssist";
vi.mock("../utils/aiAssist", () => ({ runAIAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const cfg = { endpoint: "https://x/v1/chat/completions", model: "m", apiKey: "k" };
const noop = () => {};

describe("AIBubble", () => {
    it("shows streamed text, disables insertion during generation, and supports Stop", async () => {
        let token!: (delta: string) => void;
        vi.mocked(runAIAction).mockImplementation((_action, _text, _cfg, signal, onToken) => {
            token = onToken!;
            return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
        });
        render(<AIBubble anchor={{ x: 10, y: 10 }} selectedText="hello" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />);
        fireEvent.click(screen.getByText("Expand"));
        act(() => token("streamed suggestion"));
        expect(screen.getByText("streamed suggestion")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull());
        expect(screen.getByRole("button", { name: "Expand", exact: true })).not.toBeDisabled();
    });
    it("renders nothing without an anchor", () => {
        const { container } = render(
            <AIBubble anchor={null} selectedText="x" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("shows no action buttons when nothing is selected", () => {
        render(
            <AIBubble anchor={{ x: 0, y: 0 }} selectedText="" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />
        );
        expect(screen.queryByText("Continue")).toBeNull();
        expect(screen.queryByText("Rewrite")).toBeNull();
    });

    it("shows selection actions when text is selected", () => {
        render(
            <AIBubble anchor={{ x: 0, y: 0 }} selectedText="hello" config={cfg} onReplace={noop} onInsert={noop} onClose={noop} />
        );
        expect(screen.getByText("Rewrite")).toBeInTheDocument();
        expect(screen.getByText("Shorten")).toBeInTheDocument();
        expect(screen.getByText("Expand")).toBeInTheDocument();
    });
});
