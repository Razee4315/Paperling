// Chat persistence and the history dropdown (#111). The panel unmounts when
// closed, so before this its conversation died with it; these cover the parts
// that make close/reopen and switching chats non-destructive.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { AIPanel } from "./AIPanel";
import { getChatSessions, setChatSessions } from "../utils/persistence";
import type { ChatSession } from "../utils/chatSessions";

// Nothing here streams; the panel only renders stored transcripts.
vi.mock("../utils/aiChat", async (orig) => ({
    ...(await orig<typeof import("../utils/aiChat")>()),
    streamChat: vi.fn(),
}));

const cfg = { endpoint: "https://x/v1/chat/completions", model: "m", apiKey: "k" };

const baseProps = {
    isOpen: true,
    onClose: () => {},
    note: "the document",
    fileName: "note.md",
    selectionText: "",
    aiConfig: cfg,
    width: 400,
    onWidthChange: () => {},
};

/**
 * A stored chat. `text` is the user's question AND the title, because titles are
 * derived from the first user message: the panel re-commits the chat it has open
 * on mount, which recomputes that title. A fixture whose title disagreed with
 * its messages would be silently rewritten and the test would chase a ghost.
 */
const session = (id: string, updatedAt: number, text: string): ChatSession => ({
    id,
    title: text,
    updatedAt,
    messages: [
        { role: "user", content: text },
        { role: "assistant", content: `answer about ${text}` },
    ],
});

/** A click that also fires the mousedown the outside-click watcher listens for. */
const click = (el: HTMLElement) => {
    act(() => {
        fireEvent.mouseDown(el);
        fireEvent.click(el);
    });
};

const openHistory = () => click(screen.getByLabelText("Chat history"));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("AIPanel chat history", () => {
    it("resumes the most recent chat on mount", () => {
        setChatSessions([session("a", 1, "older question"), session("b", 9, "newest question")]);

        render(<AIPanel {...baseProps} />);

        // The newest session's transcript, not an empty panel.
        expect(screen.getByText("newest question")).toBeInTheDocument();
        expect(screen.queryByText("older question")).toBeNull();
    });

    it("survives the panel closing and reopening", () => {
        setChatSessions([session("a", 5, "remember me")]);

        const first = render(<AIPanel {...baseProps} />);
        expect(screen.getByText("remember me")).toBeInTheDocument();

        // Closing the panel unmounts it entirely — that was the bug.
        first.unmount();
        render(<AIPanel {...baseProps} />);

        expect(screen.getByText("remember me")).toBeInTheDocument();
    });

    it("shows an empty panel when nothing was ever stored", () => {
        render(<AIPanel {...baseProps} />);
        expect(screen.getByText("Ask about this note")).toBeInTheDocument();
        // Nothing to browse, so the history button is not offered.
        expect(screen.getByLabelText("Chat history")).toBeDisabled();
    });

    it("lists stored chats in the dropdown, newest first", () => {
        setChatSessions([session("a", 1, "first topic"), session("b", 2, "second topic")]);

        render(<AIPanel {...baseProps} />);
        openHistory();

        expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
            "second topic",
            "first topic",
        ]);
    });

    it("switches to a chat picked from history", () => {
        setChatSessions([session("a", 1, "the old question"), session("b", 2, "the new question")]);

        render(<AIPanel {...baseProps} />);
        expect(screen.getByText("the new question")).toBeInTheDocument();

        openHistory();
        click(screen.getByRole("menuitem", { name: "the old question" }));

        expect(screen.getByText("the old question")).toBeInTheDocument();
        expect(screen.queryByText("the new question")).toBeNull();
    });

    it("starting a new chat keeps the previous one in history", () => {
        setChatSessions([session("a", 5, "prior question")]);

        render(<AIPanel {...baseProps} />);
        click(screen.getByLabelText("New chat"));

        // Fresh, empty chat...
        expect(screen.getByText("Ask about this note")).toBeInTheDocument();
        expect(screen.queryByText("prior question")).toBeNull();

        // ...and the old one is still reachable and still stored.
        openHistory();
        expect(screen.getByRole("menuitem", { name: "prior question" })).toBeInTheDocument();
        expect(getChatSessions().some((s) => s.id === "a")).toBe(true);
    });

    it("deletes a chat from history and from storage", async () => {
        setChatSessions([session("a", 1, "keep me"), session("b", 2, "delete me")]);

        render(<AIPanel {...baseProps} />);
        openHistory();
        click(screen.getByLabelText("Delete chat: keep me"));

        await waitFor(() => expect(getChatSessions().map((s) => s.id)).toEqual(["b"]));
        expect(screen.queryByRole("menuitem", { name: "keep me" })).toBeNull();
    });

    it("deleting the open chat leaves an empty one, not a stale transcript", () => {
        setChatSessions([session("b", 9, "showing now")]);

        render(<AIPanel {...baseProps} />);
        expect(screen.getByText("showing now")).toBeInTheDocument();

        openHistory();
        click(screen.getByLabelText("Delete chat: showing now"));

        expect(screen.queryByText("showing now")).toBeNull();
        expect(screen.getByText("Ask about this note")).toBeInTheDocument();
    });

    it("closes the dropdown on Escape", () => {
        setChatSessions([session("a", 1, "some chat")]);

        render(<AIPanel {...baseProps} />);
        openHistory();
        expect(screen.getByRole("menu")).toBeInTheDocument();

        act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("closes the dropdown on a click outside it", () => {
        setChatSessions([session("a", 1, "some chat")]);

        render(<AIPanel {...baseProps} />);
        openHistory();
        expect(screen.getByRole("menu")).toBeInTheDocument();

        act(() => { fireEvent.mouseDown(document.body); });
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("ignores a corrupted stored value instead of failing to render", () => {
        localStorage.setItem("paperling:aiChatSessions", "{not json");
        render(<AIPanel {...baseProps} />);
        expect(screen.getByText("Ask about this note")).toBeInTheDocument();
    });

    it("does not store an empty chat just because the panel was opened", () => {
        render(<AIPanel {...baseProps} />);
        expect(getChatSessions()).toEqual([]);
    });
});

describe("AIPanel width", () => {
    it("applies the width it is given", () => {
        const { container } = render(<AIPanel {...baseProps} width={640} />);
        expect((container.querySelector("aside") as HTMLElement).style.width).toBe("640px");
    });

    it("exposes a resize separator carrying the current width", () => {
        render(<AIPanel {...baseProps} width={512} />);
        expect(screen.getByRole("separator", { name: "Resize AI panel" })).toHaveAttribute(
            "aria-valuenow",
            "512"
        );
    });
});
