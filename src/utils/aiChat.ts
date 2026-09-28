/**
 * Streaming chat client for the AI panel — talks to the same OpenAI-compatible
 * endpoint as aiAssist (OpenAI, Gemini's OpenAI-compat layer, Ollama, etc.) but
 * with `stream: true` so the panel can render tokens as they arrive.
 */

import { isValidEndpoint, endpointLeaksKey, INSECURE_KEY_MESSAGE, type AIConfig } from "./aiAssist";
import { aiFetch } from "./aiTransport";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
    role: ChatRole;
    content: string;
}

const AI_CONNECT_TIMEOUT_MS = 120_000;

function mapHttpError(status: number, body: string): string {
    const detail = body.trim().slice(0, 200);
    let msg: string;
    if (status === 401 || status === 403) msg = "API key invalid or unauthorized — check Settings → AI.";
    else if (status === 404) msg = "Endpoint not found (404) — check the URL in Settings → AI.";
    else if (status === 429) msg = "Rate limited (429) — wait a moment and try again.";
    else if (status >= 500) msg = `AI service unavailable (${status}). Try again later.`;
    else msg = `AI request failed (${status}).`;
    return detail ? `${msg}\n${detail}` : msg;
}

/** Pull assistant text from a non-streamed completion (OpenAI or Ollama shape). */
function extractContent(data: unknown): string {
    const d = data as { choices?: Array<{ message?: { content?: string } }>; message?: { content?: string } };
    return d?.choices?.[0]?.message?.content ?? d?.message?.content ?? "";
}

/**
 * Stream a chat completion. Calls `onToken` with each incremental delta and
 * resolves with the full text. Aborts cleanly via `opts.signal`.
 */
export async function streamChat(
    messages: ChatMessage[],
    cfg: AIConfig,
    opts: { signal?: AbortSignal; onToken?: (delta: string) => void; temperature?: number } = {}
): Promise<string> {
    if (!cfg.endpoint) throw new Error("AI endpoint not configured. Open Settings → AI to set one up.");
    if (!isValidEndpoint(cfg.endpoint)) throw new Error("AI endpoint must be a valid http:// or https:// URL.");
    if (endpointLeaksKey(cfg.endpoint, cfg.apiKey)) throw new Error(INSECURE_KEY_MESSAGE);
    if (!cfg.model) throw new Error("AI model not configured.");

    let status = 0;
    let sawDataLine = false;
    let buffer = "";
    let full = "";

    const parseSseLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        sawDataLine = true;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
            const json = JSON.parse(payload);
            const delta: string = json?.choices?.[0]?.delta?.content ?? "";
            if (delta) {
                full += delta;
                opts.onToken?.(delta);
            }
        } catch {
            /* partial JSON across chunk boundary — completed on next read */
        }
    };

    let res;
    try {
        res = await aiFetch(
            cfg.endpoint,
            cfg.apiKey,
            JSON.stringify({
                model: cfg.model,
                messages,
                temperature: opts.temperature ?? 0.4,
                stream: true,
            }),
            {
                signal: opts.signal,
                // Guards only until the response headers arrive (no totalTimeoutMs)
                // so a long generation isn't cut off mid-stream.
                connectTimeoutMs: AI_CONNECT_TIMEOUT_MS,
                onStatus: (s) => {
                    status = s;
                },
                onChunk: (text) => {
                    // A non-OK body isn't SSE — let aiFetch accumulate it for the
                    // error mapping below instead of parsing it as deltas.
                    if (status < 200 || status >= 300) return;
                    buffer += text;
                    // Process complete SSE lines; keep any trailing partial line
                    // buffered. The Rust side already delivers whole lines, but
                    // this tolerates any chunking.
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) parseSseLine(line);
                },
            }
        );
    } catch (e) {
        // The transport's raw "timed out" is not user-facing copy. (User
        // aborts arrive as AbortError and rethrow untouched.)
        if (e instanceof Error && e.message.includes("timed out")) {
            throw new Error(`AI endpoint did not respond within ${AI_CONNECT_TIMEOUT_MS / 1000}s.`);
        }
        throw e;
    }

    if (status < 200 || status >= 300) {
        throw new Error(mapHttpError(status, res.body));
    }

    // Endpoint ignored `stream: true` — no SSE frames arrived, but the body is
    // a regular (non-streamed) completion. Read the whole thing.
    if (!sawDataLine) {
        let data: unknown;
        try {
            data = JSON.parse(res.body);
        } catch {
            return full; // not SSE and not JSON — nothing usable
        }
        const content = extractContent(data);
        if (content) opts.onToken?.(content);
        return content;
    }

    return full;
}

// ===== Prompt + message construction =====
//
// Token efficiency: the (possibly large) document is included only in the LATEST
// user turn — never duplicated through the conversation history. Prior turns are
// just the plain Q/A text. The caller trims history length.

export const ASK_SYSTEM_PROMPT =
    "You are the writing assistant inside Paperling, a Markdown editor. Answer the " +
    "user's questions about their current Markdown document clearly and concisely, " +
    "formatted in Markdown. This is a read-only Q&A mode — do not rewrite or output " +
    "the whole document unless explicitly asked.";

/** Wrap untrusted document text in tags (avoids colliding with the doc's own ``` fences). */
function asDocument(note: string): string {
    return `<document>\n${note}\n</document>`;
}

export function buildAskMessages(
    history: ChatMessage[],
    note: string,
    selection: string,
    userInput: string
): ChatMessage[] {
    const ctx = selection.trim()
        ? `Current document:\n${asDocument(note)}\n\nThe user has selected this passage:\n${asDocument(selection)}`
        : `Current document:\n${asDocument(note)}`;
    return [
        { role: "system", content: ASK_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: `${ctx}\n\n---\nQuestion: ${userInput}` },
    ];
}

// ===== Agent / Edit mode =====

export const AGENT_SYSTEM_PROMPT =
    "You are the agent inside Paperling, a Markdown editor, working on the user's current document.\n\n" +
    "Decide what the user wants:\n" +
    "- If they ask a QUESTION, answer concisely in Markdown. Do NOT output edit blocks.\n" +
    "- If they ask you to CHANGE the document (edit, rewrite, add, fix, restructure), respond with edit blocks ONLY. You may put at most one short sentence of summary before the blocks.\n\n" +
    "Edit block format — one per change, EXACTLY:\n" +
    "<<<<<<< SEARCH\n" +
    "(text to find, copied verbatim from the document including whitespace; minimal but unique)\n" +
    "=======\n" +
    "(replacement text)\n" +
    ">>>>>>> REPLACE\n\n" +
    "Rules:\n" +
    "- SEARCH must match the current document character-for-character.\n" +
    "- Use several blocks for several changes.\n" +
    "- To INSERT, SEARCH a nearby existing line and repeat it unchanged in REPLACE with the new text added around it.\n" +
    "- To REWRITE the whole document, use ONE block whose SEARCH is the entire current document.\n" +
    "- Preserve the user's Markdown style, heading levels, and voice.\n" +
    "- Never wrap blocks in ``` fences. Output nothing after the final block.";

export function buildAgentMessages(
    history: ChatMessage[],
    note: string,
    selection: string,
    userInput: string
): ChatMessage[] {
    const ctx = selection.trim()
        ? `Current document:\n${asDocument(note)}\n\nThe user's current selection:\n${asDocument(selection)}`
        : `Current document:\n${asDocument(note)}`;
    return [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: `${ctx}\n\n---\nRequest: ${userInput}` },
    ];
}

export interface EditResult {
    /** Document after applying every block that matched. */
    proposedDoc: string;
    applied: number;
    failed: number;
    /** Any prose the model wrote outside the edit blocks. */
    explanation: string;
    /** True when the response contained at least one well-formed edit block. */
    hasEdits: boolean;
}

const EDIT_BLOCK_RE = /<<<<<<<[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n=======[ \t]*\r?\n([\s\S]*?)\r?\n>>>>>>>[ \t]*REPLACE/g;

/**
 * Parse SEARCH/REPLACE blocks out of an agent response and apply them to the
 * current document, in order. Each SEARCH is matched literally (first
 * occurrence). Blocks whose SEARCH isn't found are counted as failed and skipped.
 */
export function parseEdits(response: string, currentDoc: string): EditResult {
    const blocks: Array<[string, string]> = [];
    EDIT_BLOCK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EDIT_BLOCK_RE.exec(response)) !== null) {
        blocks.push([m[1], m[2]]);
    }

    let doc = currentDoc;
    let applied = 0;
    let failed = 0;
    for (const [search, replace] of blocks) {
        const idx = doc.indexOf(search);
        if (idx === -1) { failed++; continue; }
        doc = doc.slice(0, idx) + replace + doc.slice(idx + search.length);
        applied++;
    }

    const explanation = response.replace(EDIT_BLOCK_RE, "").trim();
    return { proposedDoc: doc, applied, failed, explanation, hasEdits: blocks.length > 0 };
}
