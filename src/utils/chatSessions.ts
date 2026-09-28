// Stored AI chat sessions. Issue #111.
//
// The panel unmounts when closed, so its message state used to die with it:
// closing the panel or starting a new chat threw the conversation away. These
// sessions live in localStorage instead, so chats survive closing the panel and
// restarting the app, and old ones stay reachable from the history dropdown.
//
// localStorage is a small, shared, synchronous store with no quota guarantee, so
// growth is capped on two axes (count and total characters) and the oldest
// sessions are evicted first. Everything here is pure so that eviction — the
// part that silently loses user data if it is wrong — is unit-testable.

export interface ChatSessionMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ChatSession {
    id: string;
    /** Derived from the first user message; not user-editable for now. */
    title: string;
    /** Epoch ms of the last change, used for ordering and eviction. */
    updatedAt: number;
    messages: ChatSessionMessage[];
}

/** Keep the dropdown scannable and the stored blob bounded. */
export const MAX_SESSIONS = 20;

/**
 * Total characters of message content kept across all sessions. Chat text is
 * small next to the 5 MB localStorage typically allows, but a long agent
 * conversation can run to tens of KB, so this stops unbounded growth without
 * being tight enough to notice in normal use. The document itself is never in
 * here — it is attached to the outgoing request, not to the stored transcript.
 */
export const MAX_TOTAL_CHARS = 200_000;

const TITLE_MAX = 60;

/** Unique enough for a local list; `randomUUID` is present in every target webview. */
export function makeSessionId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
    // Only reached in a non-secure context or an old engine.
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A short label for the history dropdown, taken from the first thing the user
 * said. Collapses whitespace so a pasted multi-line prompt stays one line, and
 * truncates on a word boundary when there is one to break on.
 */
export function deriveTitle(messages: readonly ChatSessionMessage[]): string {
    const first = messages.find((m) => m.role === "user" && m.content.trim());
    const text = first?.content.replace(/\s+/g, " ").trim() ?? "";
    if (!text) return "New chat";
    if (text.length <= TITLE_MAX) return text;
    const cut = text.slice(0, TITLE_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    // Only break on a space if it leaves a reasonable amount of the label.
    return (lastSpace > TITLE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

const charsOf = (s: ChatSession): number =>
    s.messages.reduce((n, m) => n + m.content.length, 0) + s.title.length;

/**
 * Enforce both caps, dropping the least recently updated sessions first.
 *
 * The newest session is always kept even if it alone exceeds the character
 * budget: the alternative is discarding the conversation the user is having
 * right now, which is worse than briefly exceeding a self-imposed limit.
 */
export function pruneSessions(sessions: readonly ChatSession[]): ChatSession[] {
    const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);

    const kept: ChatSession[] = [];
    let total = 0;
    for (const s of ordered) {
        const size = charsOf(s);
        if (kept.length > 0 && total + size > MAX_TOTAL_CHARS) break;
        kept.push(s);
        total += size;
    }
    return kept;
}

/**
 * Insert or update `session`, then prune. Returns a new list, newest first.
 *
 * A session with no messages is not stored: opening the panel and closing it
 * again should not leave an empty row in the history.
 */
export function upsertSession(sessions: readonly ChatSession[], session: ChatSession): ChatSession[] {
    const others = sessions.filter((s) => s.id !== session.id);
    if (session.messages.length === 0) return pruneSessions(others);
    return pruneSessions([...others, session]);
}

export function removeSession(sessions: readonly ChatSession[], id: string): ChatSession[] {
    return sessions.filter((s) => s.id !== id);
}

/**
 * Drop anything that does not structurally match a session, so a corrupted or
 * hand-edited localStorage entry degrades to "no history" instead of crashing
 * the panel on render.
 */
export function sanitizeSessions(raw: unknown): ChatSession[] {
    if (!Array.isArray(raw)) return [];
    const ok: ChatSession[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const s = item as Partial<ChatSession>;
        if (typeof s.id !== "string" || !s.id) continue;
        if (!Array.isArray(s.messages)) continue;
        const messages = s.messages.filter(
            (m): m is ChatSessionMessage =>
                !!m && typeof m === "object" &&
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string"
        );
        ok.push({
            id: s.id,
            title: typeof s.title === "string" && s.title ? s.title : deriveTitle(messages),
            updatedAt: typeof s.updatedAt === "number" && Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
            messages,
        });
    }
    return pruneSessions(ok);
}
