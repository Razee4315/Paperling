import { describe, it, expect, vi } from "vitest";
import { buildAskMessages, parseEdits, streamChat, type ChatMessage } from "./aiChat";
import { aiFetch } from "./aiTransport";
import type { AIConfig } from "./aiAssist";

vi.mock("./aiTransport", () => ({ aiFetch: vi.fn() }));
const mockAiFetch = vi.mocked(aiFetch);

const cfg: AIConfig = {
    endpoint: "https://api.test/v1/chat/completions",
    model: "test-model",
    apiKey: "k",
};
const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

/** Make aiFetch behave like the Rust transport: status first, then chunks. */
const streamResponse = (status: number, chunks: string[]) =>
    mockAiFetch.mockImplementation(async (_endpoint, _key, _body, opts) => {
        opts.onStatus?.(status);
        for (const chunk of chunks) opts.onChunk?.(chunk);
        return { status, body: chunks.join("") };
    });

describe("streamChat", () => {
    it("emits SSE deltas through onToken and returns the full text", async () => {
        streamResponse(200, [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
            // Two events in one chunk, plus the [DONE] sentinel.
            'data: {"choices":[{"delta":{"content":"lo"}}]}\ndata: [DONE]\n',
        ]);
        const tokens: string[] = [];
        const out = await streamChat(messages, cfg, { onToken: (d) => tokens.push(d) });
        expect(tokens).toEqual(["Hel", "lo"]);
        expect(out).toBe("Hello");
    });

    it("falls back to a single onToken when the endpoint ignores stream:true", async () => {
        streamResponse(200, [JSON.stringify({ choices: [{ message: { content: "whole reply" } }] })]);
        const tokens: string[] = [];
        const out = await streamChat(messages, cfg, { onToken: (d) => tokens.push(d) });
        expect(tokens).toEqual(["whole reply"]);
        expect(out).toBe("whole reply");
    });

    it("maps a non-OK status to the existing error message using the body", async () => {
        streamResponse(500, ["upstream exploded"]);
        await expect(streamChat(messages, cfg)).rejects.toThrow(
            "AI service unavailable (500). Try again later.\nupstream exploded"
        );
    });

    it("propagates an AbortError from the transport", async () => {
        mockAiFetch.mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
        await expect(streamChat(messages, cfg)).rejects.toMatchObject({ name: "AbortError" });
    });
});

describe("parseEdits", () => {
    const block = (s: string, r: string) => `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE`;

    it("applies a single SEARCH/REPLACE block", () => {
        const doc = "# Title\n\nHello world.\n";
        const res = parseEdits(block("Hello world.", "Hello, brave new world!"), doc);
        expect(res.hasEdits).toBe(true);
        expect(res.applied).toBe(1);
        expect(res.failed).toBe(0);
        expect(res.proposedDoc).toBe("# Title\n\nHello, brave new world!\n");
    });

    it("applies multiple blocks in order", () => {
        const doc = "alpha\nbravo\ncharlie\n";
        const resp = block("alpha", "ALPHA") + "\n" + block("charlie", "CHARLIE");
        const res = parseEdits(resp, doc);
        expect(res.applied).toBe(2);
        expect(res.proposedDoc).toBe("ALPHA\nbravo\nCHARLIE\n");
    });

    it("counts a non-matching block as failed and leaves it out", () => {
        const doc = "one two three";
        const res = parseEdits(block("nonexistent", "x"), doc);
        expect(res.applied).toBe(0);
        expect(res.failed).toBe(1);
        expect(res.proposedDoc).toBe(doc);
    });

    it("treats a plain answer (no blocks) as not-an-edit", () => {
        const res = parseEdits("This document is about robots.", "anything");
        expect(res.hasEdits).toBe(false);
        expect(res.explanation).toContain("robots");
    });

    it("separates the summary sentence from the blocks", () => {
        const resp = "Tightened the intro.\n" + block("old", "new");
        const res = parseEdits(resp, "old text");
        expect(res.applied).toBe(1);
        expect(res.explanation).toBe("Tightened the intro.");
    });

    it("rewrites the whole document when SEARCH is the entire doc", () => {
        const doc = "completely\nold\ncontent";
        const res = parseEdits(block(doc, "brand new content"), doc);
        expect(res.proposedDoc).toBe("brand new content");
    });
});

describe("buildAskMessages", () => {
    it("puts the system prompt first and the document only in the latest turn", () => {
        const history = [
            { role: "user" as const, content: "hi" },
            { role: "assistant" as const, content: "hello" },
        ];
        const msgs = buildAskMessages(history, "# My Note\nbody", "", "summarize it");

        expect(msgs[0].role).toBe("system");
        // History is carried through verbatim and stays document-free (token efficiency).
        expect(msgs.some((m) => m.content === "hi")).toBe(true);
        expect(history.every((h) => !h.content.includes("My Note"))).toBe(true);

        const last = msgs[msgs.length - 1];
        expect(last.role).toBe("user");
        expect(last.content).toContain("# My Note");
        expect(last.content).toContain("summarize it");
    });

    it("includes the selected passage when present", () => {
        const msgs = buildAskMessages([], "full document text", "the selected bit", "what is this");
        const last = msgs[msgs.length - 1];
        expect(last.content).toContain("the selected bit");
        expect(last.content.toLowerCase()).toContain("selected");
    });
});
