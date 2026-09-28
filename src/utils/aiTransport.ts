// Why Rust instead of fetch: the webview origin is https://tauri.localhost, so
// every AI call is cross-origin and most OpenAI-compatible servers fail the
// CORS preflight that browsers require (curl has no CORS, hence "works in
// curl"); plain-http LAN endpoints are additionally blocked by CSP. Routing
// through reqwest in Rust gives curl parity. AI-01.

import { Channel, invoke } from "@tauri-apps/api/core";

/** Events streamed back from the `ai_request` Rust command. */
type AiEvent =
    | { type: "status"; status: number }
    | { type: "chunk"; data: string }
    | { type: "done" };

export interface AiHttpResponse {
    status: number;
    body: string;
}

// Ids only need to be unique among in-flight requests within this webview, so
// a module counter suffices (the Rust map is keyed per id).
let nextRequestId = 0;

/**
 * POST `body` to the AI endpoint via the Rust transport. Resolves with the
 * status and full body once the response has been fully streamed; `onChunk`
 * and `onStatus` fire along the way for streaming consumers. Non-2xx statuses
 * resolve normally (callers map them to their own messages); network
 * failures, timeouts, and aborts reject.
 */
export async function aiFetch(
    endpoint: string,
    apiKey: string,
    body: string,
    opts: {
        signal?: AbortSignal;
        connectTimeoutMs: number;
        totalTimeoutMs?: number;
        onChunk?: (text: string) => void;
        onStatus?: (status: number) => void;
    }
): Promise<AiHttpResponse> {
    const abortError = () => new DOMException("The operation was aborted.", "AbortError");
    if (opts.signal?.aborted) throw abortError();

    const id = ++nextRequestId;
    let status = 0;
    let responseBody = "";
    let markDone: () => void = () => {};
    // Channel messages ride a separate IPC lane from the invoke response, so
    // the command can resolve before the last events land — wait for the
    // explicit Done marker before trusting the accumulated body.
    const done = new Promise<void>((resolve) => {
        markDone = resolve;
    });

    const channel = new Channel<AiEvent>();
    channel.onmessage = (event) => {
        if (event.type === "status") {
            status = event.status;
            opts.onStatus?.(event.status);
        } else if (event.type === "chunk") {
            responseBody += event.data;
            opts.onChunk?.(event.data);
        } else {
            markDone();
        }
    };

    const onAbort = () => {
        // Fire-and-forget: the request itself rejects with "cancelled".
        void invoke("ai_cancel", { id }).catch(() => {});
    };
    opts.signal?.addEventListener("abort", onAbort);

    try {
        await invoke("ai_request", {
            id,
            endpoint,
            apiKey: apiKey || null,
            body,
            connectTimeoutMs: opts.connectTimeoutMs,
            totalTimeoutMs: opts.totalTimeoutMs ?? null,
            channel,
        });
        // Done follows the command result almost immediately; the race guards
        // against a lost event wedging this promise (webview teardown edge).
        await Promise.race([done, new Promise<void>((r) => setTimeout(r, 5000))]);
        // An abort that landed after the Rust side already finished resolves
        // normally (ai_cancel no-ops) — without this, a stale suggestion could
        // surface in a bubble the user already dismissed.
        if (opts.signal?.aborted) throw abortError();
    } catch (e) {
        // Tauri command rejections are plain strings, not Errors.
        const msg = String(e);
        if (msg === "cancelled" || opts.signal?.aborted) throw abortError();
        throw new Error(msg);
    } finally {
        opts.signal?.removeEventListener("abort", onAbort);
    }

    return { status, body: responseBody };
}
