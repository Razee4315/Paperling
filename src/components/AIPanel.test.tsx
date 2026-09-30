import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AIPanel } from "./AIPanel";
import { streamChat } from "../utils/aiChat";
import { getChatSessions } from "../utils/persistence";

vi.mock("../utils/aiChat", async (original) => ({ ...await original<typeof import("../utils/aiChat")>(), streamChat: vi.fn() }));
const props = { isOpen: true, onClose: vi.fn(), note: "old text", docKey: "tab-1", fileName: "a.md", selectionText: "", aiConfig: { endpoint: "http://localhost:1234/v1/chat/completions", model: "local", apiKey: "" }, width: 400, onWidthChange: vi.fn() };
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });
async function send(text: string) {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull());
}

it("edits in the composer, cancels without changing history, then replaces later turns on send", async () => {
    vi.mocked(streamChat).mockImplementation(async (_messages, _cfg, opts) => { opts?.onToken?.("answer"); return "answer"; });
    render(<AIPanel {...props} />);
    await send("first");
    await send("second");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit message 1" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("first");
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("draft");
    expect(screen.getByText("second")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit message 1" }));
    await send("corrected");
    expect(screen.queryByText("second")).toBeNull();
    const outgoing = vi.mocked(streamChat).mock.calls.at(-1)![0];
    expect(outgoing).toHaveLength(2);
    expect(outgoing[1].content).toContain("corrected");
    await waitFor(() => expect(getChatSessions()[0].messages.map((message) => message.content)).toEqual(["corrected", "answer"]));
});

it("regenerates the latest reply without duplicating the question or losing the draft", async () => {
    const discard = vi.fn();
    vi.mocked(streamChat).mockImplementation(async (_messages, _cfg, opts) => { opts?.onToken?.("answer"); return "answer"; });
    render(<AIPanel {...props} onDiscardEdit={discard} />);
    await send("question");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "next draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate reply" }));
    await waitFor(() => expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(streamChat).mock.calls[1][0]).toHaveLength(2);
    expect(screen.getAllByText("question")).toHaveLength(1);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("next draft");
    expect(discard).toHaveBeenCalledTimes(2);
});

it("explains a reply without edits and offers a review only after an explicit click", async () => {
    const propose = vi.fn();
    vi.mocked(streamChat).mockImplementation(async (_messages, _cfg, opts) => { opts?.onToken?.("# Replacement"); return "# Replacement"; });
    render(<AIPanel {...props} onProposeEdit={propose} />);
    fireEvent.click(screen.getByRole("button", { name: "agent", exact: true }));
    await send("rewrite the document");
    expect(screen.getByText(/No document changes were proposed/)).toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review full reply as replacement document" }));
    expect(propose).toHaveBeenCalledWith("# Replacement");
});

it("rejects a stale Agent response after switching to a tab with identical text", async () => {
    const propose = vi.fn();
    let finish!: (reply: string) => void;
    vi.mocked(streamChat).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<AIPanel {...props} onProposeEdit={propose} />);
    fireEvent.click(screen.getByRole("button", { name: "agent", exact: true }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "rewrite" } });
    fireEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
    rerender(<AIPanel {...props} docKey="tab-2" onProposeEdit={propose} />);
    await act(async () => finish("<<<<<<< SEARCH\nold text\n=======\nnew text\n>>>>>>> REPLACE"));
    expect(propose).not.toHaveBeenCalled();
    expect(screen.getByText(/document changed while/)).toBeInTheDocument();
});

it("ignores late tokens and completion from an aborted previous chat", async () => {
    let finish!: (reply: string) => void;
    let token!: (delta: string) => void;
    vi.mocked(streamChat).mockImplementation((_messages, _cfg, opts) => { token = opts!.onToken!; return new Promise((resolve) => { finish = resolve; }); });
    render(<AIPanel {...props} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "old question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await act(async () => { token("stale reply"); finish("stale reply"); });
    expect(screen.queryByText("stale reply")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
});
