import { describe, it, expect, vi } from "vitest";
import { isValidEndpoint, endpointLeaksKey, runAIAction, type AIConfig } from "./aiAssist";
import { aiFetch } from "./aiTransport";

vi.mock("./aiTransport", () => ({ aiFetch: vi.fn() }));
const mockAiFetch = vi.mocked(aiFetch);

const cfg = (over: Partial<AIConfig> = {}): AIConfig => ({
    endpoint: "https://api.test/v1/chat/completions",
    model: "test-model",
    apiKey: "k",
    ...over,
});

/** Shorthand for a transport response the Rust command would deliver. */
const respond = (status: number, body: unknown) =>
    mockAiFetch.mockResolvedValue({
        status,
        body: typeof body === "string" ? body : JSON.stringify(body),
    });

describe("isValidEndpoint", () => {
    it("accepts http and https", () => {
        expect(isValidEndpoint("http://localhost:11434/v1/chat/completions")).toBe(true);
        expect(isValidEndpoint("https://api.openai.com/v1/chat/completions")).toBe(true);
    });
    it("rejects other schemes and garbage", () => {
        expect(isValidEndpoint("ftp://x")).toBe(false);
        expect(isValidEndpoint("not a url")).toBe(false);
        expect(isValidEndpoint("")).toBe(false);
    });
});

describe("endpointLeaksKey", () => {
    it("is false whenever there is no key to leak", () => {
        // Keyless plain-http LAN servers stay allowed on purpose (issue #91).
        expect(endpointLeaksKey("http://192.168.1.50:11434/v1", "")).toBe(false);
        expect(endpointLeaksKey("http://192.168.1.50:11434/v1", undefined)).toBe(false);
        expect(endpointLeaksKey("http://192.168.1.50:11434/v1", null)).toBe(false);
    });

    it("is false for https regardless of host", () => {
        expect(endpointLeaksKey("https://api.openai.com/v1", "sk-abc")).toBe(false);
        expect(endpointLeaksKey("https://192.168.1.50/v1", "sk-abc")).toBe(false);
    });

    it("is false for plain http to loopback", () => {
        expect(endpointLeaksKey("http://localhost:1234/v1", "sk-abc")).toBe(false);
        expect(endpointLeaksKey("http://127.0.0.1:11434/v1", "sk-abc")).toBe(false);
        expect(endpointLeaksKey("http://127.1.2.3:11434/v1", "sk-abc")).toBe(false);
        expect(endpointLeaksKey("http://[::1]:11434/v1", "sk-abc")).toBe(false);
        expect(endpointLeaksKey("http://ollama.localhost:11434/v1", "sk-abc")).toBe(false);
    });

    it("is true for plain http to anything off the box", () => {
        expect(endpointLeaksKey("http://192.168.1.50:11434/v1", "sk-abc")).toBe(true);
        expect(endpointLeaksKey("http://api.openai.com/v1", "sk-abc")).toBe(true);
        expect(endpointLeaksKey("http://10.0.0.7/v1", "sk-abc")).toBe(true);
        expect(endpointLeaksKey("http://0.0.0.0:11434/v1", "sk-abc")).toBe(true);
        // A hostname merely starting with "localhost" is a different host.
        expect(endpointLeaksKey("http://localhost.evil.com/v1", "sk-abc")).toBe(true);
    });
});

describe("runAIAction config guards", () => {
    it("throws when endpoint missing", async () => {
        await expect(runAIAction("rewrite", "hi", cfg({ endpoint: "" }))).rejects.toThrow(/endpoint not configured/i);
    });
    it("throws for an invalid endpoint URL", async () => {
        await expect(runAIAction("rewrite", "hi", cfg({ endpoint: "nope" }))).rejects.toThrow(/valid http/i);
    });
    it("throws when model missing", async () => {
        await expect(runAIAction("rewrite", "hi", cfg({ model: "" }))).rejects.toThrow(/model not configured/i);
    });
    it("refuses to send a key over plain http to a remote host", async () => {
        const insecure = cfg({ endpoint: "http://192.168.1.50:11434/v1", apiKey: "sk-abc" });
        await expect(runAIAction("rewrite", "hi", insecure)).rejects.toThrow(/unencrypted/i);
        // Nothing may reach the transport: the key must not leave the app.
        expect(mockAiFetch).not.toHaveBeenCalled();
    });
    it("allows the same remote host over plain http when there is no key", async () => {
        respond(200, { choices: [{ message: { content: "ok" } }] });
        const keyless = cfg({ endpoint: "http://192.168.1.50:11434/v1", apiKey: "" });
        await expect(runAIAction("rewrite", "hi", keyless)).resolves.toBe("ok");
    });
});

describe("runAIAction request handling", () => {
    it("returns the OpenAI-style content on success", async () => {
        respond(200, { choices: [{ message: { content: "  hello  " } }] });
        await expect(runAIAction("rewrite", "x", cfg())).resolves.toBe("hello");
    });

    it("supports the Ollama native shape", async () => {
        respond(200, { message: { content: "ollama out" } });
        await expect(runAIAction("continue", "x", cfg())).resolves.toBe("ollama out");
    });

    it("maps a 401 to an actionable message", async () => {
        respond(401, "unauthorized");
        await expect(runAIAction("rewrite", "x", cfg())).rejects.toThrow(/api key invalid or unauthorized/i);
    });

    it("throws on an empty response", async () => {
        respond(200, { choices: [{ message: { content: "" } }] });
        await expect(runAIAction("rewrite", "x", cfg())).rejects.toThrow(/empty response/i);
    });

    it("truncates a runaway response", async () => {
        respond(200, { choices: [{ message: { content: "a".repeat(300_000) } }] });
        const out = await runAIAction("expand", "x", cfg());
        expect(out.length).toBeLessThan(210_000);
        expect(out.endsWith("[Response truncated]")).toBe(true);
    });

    it("maps a transport timeout to the 60s message", async () => {
        mockAiFetch.mockRejectedValue(new Error("timed out"));
        await expect(runAIAction("rewrite", "x", cfg())).rejects.toThrow("AI request timed out after 60s.");
    });

    it("lets a user abort propagate as AbortError", async () => {
        mockAiFetch.mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
        await expect(runAIAction("rewrite", "x", cfg())).rejects.toMatchObject({ name: "AbortError" });
    });
});
