import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, buildAskMessages, buildAgentMessages, parseEdits, type ChatMessage } from "../utils/aiChat";
import type { AIConfig } from "../utils/aiAssist";
import {
    getAIHistoryTurns,
    getChatSessions,
    setChatSessions,
    setAIPanelWidth,
    AI_PANEL_WIDTH_MIN,
    AI_PANEL_WIDTH_MAX,
} from "../utils/persistence";
import {
    deriveTitle,
    makeSessionId,
    upsertSession,
    removeSession,
    type ChatSession,
} from "../utils/chatSessions";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { IS_MOBILE } from "../utils/platform";
import mascotWizard from "../assets/mascot/mascot-wizard.png";

interface AIPanelProps {
    isOpen: boolean;
    onClose: () => void;
    /** Current document text. */
    note: string;
    fileName: string;
    /** Currently-selected text in the editor, if any. */
    selectionText: string;
    aiConfig: AIConfig;
    /** Called (Agent mode) with the proposed document to review in the editor. */
    onProposeEdit?: (proposedDoc: string) => void;
    /** Live panel width in px; owned by App so the editor can reserve the space. */
    width: number;
    /** Fires continuously while the edge is dragged. */
    onWidthChange: (px: number) => void;
}

interface UIMessage {
    role: "user" | "assistant";
    content: string;
}

// The number of prior turns sent as conversation context is a user setting
// (Settings → AI, default 8), read live per send — the document itself is
// attached only to the latest turn inside buildAskMessages.

export function AIPanel({ isOpen, onClose, note, fileName, selectionText, aiConfig, onProposeEdit, width, onWidthChange }: AIPanelProps) {
    // Stored chats (#111). Closing the panel unmounts it, so message state used
    // to die with it. Read the saved history once, then resume the most recent
    // chat, which makes close/reopen and app restarts non-destructive.
    const storedRef = useRef<ChatSession[] | null>(null);
    if (storedRef.current === null) storedRef.current = getChatSessions();
    const [sessions, setSessions] = useState<ChatSession[]>(() => storedRef.current ?? []);
    const [sessionId, setSessionId] = useState<string>(() => storedRef.current?.[0]?.id ?? makeSessionId());
    const [messages, setMessages] = useState<UIMessage[]>(() => storedRef.current?.[0]?.messages ?? []);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [input, setInput] = useState("");
    // Read by callbacks that must see the newest list without being rebuilt on
    // every change (and without a self-triggering effect dependency).
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    // Ref twin of `input` so the open-effect can restore the draft without
    // re-running on every keystroke.
    const inputDraftRef = useRef("");
    const [mode, setMode] = useState<"ask" | "agent">("ask");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const configured = !!aiConfig.endpoint && !!aiConfig.model;

    // On open, the textarea has just remounted (closing renders null): restore
    // any draft from the state mirror into the uncontrolled DOM node, then focus.
    useEffect(() => {
        if (!isOpen) return;
        const el = inputRef.current;
        if (el) {
            el.value = inputDraftRef.current;
            el.focus();
        }
    }, [isOpen]);
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);
    useEffect(() => () => abortRef.current?.abort(), []);

    // Auto-grow the composer as the user types more lines (up to a max, then
    // scroll). Without this the single-row textarea just scrolls internally and
    // hides earlier lines. Reset to one row when cleared.
    const AI_INPUT_MAX_PX = 168;
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, AI_INPUT_MAX_PX) + "px";
        el.style.overflowY = el.scrollHeight > AI_INPUT_MAX_PX ? "auto" : "hidden";
    }, [input]);

    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || busy) return;
        if (!configured) { setError("Configure an AI endpoint in Settings → AI first."); return; }
        setError(null);
        // The textarea is uncontrolled (see below) — clear the DOM value directly
        // and keep the state mirror in sync for the send button / auto-grow.
        if (inputRef.current) inputRef.current.value = "";
        inputDraftRef.current = "";
        setInput("");

        // Prior turns as plain Q/A (no document) — the doc is attached only to the
        // newest user turn by buildAskMessages.
        const turns = getAIHistoryTurns();
        const history: ChatMessage[] = turns > 0
            ? messages.slice(-turns * 2).map((m) => ({ role: m.role, content: m.content }))
            : [];

        const withUser: UIMessage[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
        const assistantIdx = withUser.length - 1;
        setMessages(withUser);
        setBusy(true);

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
            const msgs = mode === "agent"
                ? buildAgentMessages(history, note, selectionText, text)
                : buildAskMessages(history, note, selectionText, text);
            const full = await streamChat(msgs, aiConfig, {
                signal: ctrl.signal,
                onToken: (delta) => {
                    setMessages((prev) => {
                        const copy = prev.slice();
                        const cur = copy[assistantIdx];
                        if (cur) copy[assistantIdx] = { role: "assistant", content: cur.content + delta };
                        return copy;
                    });
                },
            });
            // Agent mode: if the reply was edit blocks, apply them and hand the
            // proposed document to the editor for review (replacing the raw blocks
            // that briefly streamed into the bubble with a clean summary).
            if (mode === "agent") {
                const res = parseEdits(full, note);
                if (res.hasEdits) {
                    let summary: string;
                    if (res.applied > 0) {
                        onProposeEdit?.(res.proposedDoc);
                        summary = `${res.explanation ? res.explanation + "\n\n" : ""}**Proposed ${res.applied} change${res.applied !== 1 ? "s" : ""}.** Review and Accept/Reject them in the editor.${res.failed ? `\n\n⚠️ ${res.failed} change${res.failed !== 1 ? "s" : ""} couldn't be applied, the text may have shifted. Try again.` : ""}`;
                    } else {
                        summary = "I drafted changes but none matched the current document (it may have changed since). Please try again.";
                    }
                    setMessages((prev) => {
                        const copy = prev.slice();
                        if (copy[assistantIdx]) copy[assistantIdx] = { role: "assistant", content: summary };
                        return copy;
                    });
                }
                // No edit blocks → it was an answer; the streamed text stays as-is.
            }
        } catch (e) {
            if ((e as Error).name !== "AbortError") setError((e as Error).message);
            // Drop the empty assistant bubble if nothing streamed in.
            setMessages((prev) => (prev[assistantIdx]?.content ? prev : prev.slice(0, assistantIdx)));
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    }, [input, busy, configured, messages, note, selectionText, aiConfig, mode, onProposeEdit]);

    const stop = useCallback(() => abortRef.current?.abort(), []);

    /** Write one chat into the stored history. Empty chats are not stored. */
    const commitSession = useCallback((id: string, msgs: UIMessage[]) => {
        if (!msgs.length) return;
        const next = upsertSession(sessionsRef.current, {
            id,
            title: deriveTitle(msgs),
            updatedAt: Date.now(),
            messages: msgs,
        });
        sessionsRef.current = next;
        setSessions(next);
        setChatSessions(next);
    }, []);

    // Save the active chat once it settles. Gated on `busy` so a streaming reply
    // doesn't write to localStorage on every token; the transition back to idle
    // (success, error, or abort) is what persists the final transcript.
    useEffect(() => {
        if (busy) return;
        commitSession(sessionId, messages);
    }, [busy, messages, sessionId, commitSession]);

    // Start a fresh chat, keeping the current one in history. This is the button
    // that used to be "clear", which discarded the conversation outright (#111).
    const newChat = useCallback(() => {
        abortRef.current?.abort();
        commitSession(sessionId, messages);
        setSessionId(makeSessionId());
        setMessages([]);
        setError(null);
        setHistoryOpen(false);
    }, [commitSession, sessionId, messages]);

    const selectSession = useCallback((id: string) => {
        setHistoryOpen(false);
        if (id === sessionId) return;
        abortRef.current?.abort();
        // Save where we are before moving, so switching away mid-conversation
        // (or mid-stream) doesn't lose it.
        commitSession(sessionId, messages);
        const target = sessionsRef.current.find((s) => s.id === id);
        if (!target) return;
        setSessionId(id);
        setMessages(target.messages);
        setError(null);
    }, [commitSession, sessionId, messages]);

    const deleteSession = useCallback((id: string) => {
        const next = removeSession(sessionsRef.current, id);
        sessionsRef.current = next;
        setSessions(next);
        setChatSessions(next);
        // Deleting the open chat leaves an empty one rather than a stale view.
        if (id === sessionId) {
            abortRef.current?.abort();
            setSessionId(makeSessionId());
            setMessages([]);
            setError(null);
        }
    }, [sessionId]);

    // Close the history dropdown on Escape or a click elsewhere.
    const historyRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!historyOpen) return;
        const onDown = (e: MouseEvent) => {
            if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopPropagation(); setHistoryOpen(false); }
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey, true);
        };
    }, [historyOpen]);

    if (!isOpen) return null;

    // Enter-to-send is a desktop convention. On a phone the return key is where
    // newline lives (there is no Shift to hold), and Enter-that-sends posts
    // half a thought repeatedly — so on mobile Enter inserts a newline and the
    // always-visible send button is the send path.
    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!IS_MOBILE && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    return (
        <aside
            role="complementary"
            aria-label="AI assistant"
            data-panel="right"
            // Width is a persisted user setting dragged from the left edge (#111).
            // max-w keeps it on screen if the window is narrower than the stored px.
            // On mobile the shell CSS overrides this to a full-screen sheet
            // (100% width, no resize handle).
            style={{ width: `${width}px` }}
            className="fixed right-0 top-12 bottom-7 max-w-[90vw] z-50 flex flex-col bg-[var(--bg-secondary)] border-l border-[var(--border)] shadow-2xl"
        >
            {!IS_MOBILE && (
                <PanelResizeHandle
                    width={width}
                    min={AI_PANEL_WIDTH_MIN}
                    max={AI_PANEL_WIDTH_MAX}
                    onResize={onWidthChange}
                    onCommit={setAIPanelWidth}
                    label="Resize AI panel"
                />
            )}

            {/* Header */}
            <div className="h-10 shrink-0 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select tracking-tight">
                    <span>AI Assistant</span>
                </div>
                <div className="flex items-center gap-1">
                    {/* Chat history (#111): past chats stay reachable instead of
                        being discarded when the panel closes or a new chat starts. */}
                    <div ref={historyRef} className="relative">
                        <button
                            onClick={() => setHistoryOpen((v) => !v)}
                            title="Chat history"
                            aria-label="Chat history"
                            aria-haspopup="menu"
                            aria-expanded={historyOpen}
                            disabled={sessions.length === 0}
                            className="w-7 h-7 rounded-[var(--radius-sm)] enabled:hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] enabled:hover:text-[var(--text-primary)] flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[18px]">history</span>
                        </button>
                        {historyOpen && sessions.length > 0 && (
                            <div
                                role="menu"
                                aria-label="Previous chats"
                                className="absolute right-0 top-8 w-64 max-h-80 overflow-y-auto z-20 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-2xl py-1 animate-fade-in"
                            >
                                {sessions.map((s) => (
                                    <div
                                        key={s.id}
                                        className={`group flex items-center gap-1 px-1 ${s.id === sessionId ? "bg-[var(--bg-hover)]" : ""}`}
                                    >
                                        <button
                                            role="menuitem"
                                            onClick={() => selectSession(s.id)}
                                            title={s.title}
                                            className="flex-1 min-w-0 text-left px-2 py-1.5 text-xs rounded-[var(--radius-sm)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                                        >
                                            <span className="block truncate">{s.title}</span>
                                        </button>
                                        <button
                                            onClick={() => deleteSession(s.id)}
                                            title="Delete chat"
                                            aria-label={`Delete chat: ${s.title}`}
                                            className={`shrink-0 w-6 h-6 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 flex items-center justify-center focus:opacity-100 transition-opacity ${
                                                // A hover-only delete is unreachable on
                                                // touch — keep it permanently visible there.
                                                IS_MOBILE ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                            }`}
                                        >
                                            <span className="material-symbols-outlined text-[15px]">delete</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {messages.length > 0 && (
                        <button onClick={newChat} title="New chat" aria-label="New chat" className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-[18px]">add_comment</span>
                        </button>
                    )}
                    <button onClick={onClose} title="Close" aria-label="Close AI panel" className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            {/* Context indicator + Ask/Agent mode toggle */}
            <div className="px-3 py-1.5 shrink-0 border-b border-[var(--border-subtle)] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[13px] text-[var(--text-muted)]">description</span>
                <span className="truncate text-[11px] text-[var(--text-muted)] min-w-0">{fileName || "Untitled"}</span>
                {selectionText.trim() && (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--accent)] text-[11px] shrink-0">selection</span>
                )}
                <div className="ml-auto flex items-center gap-0.5 bg-[var(--bg-input)] rounded-[var(--radius-sm)] p-0.5 border border-[var(--border-subtle)] shrink-0">
                    {(["ask", "agent"] as const).map((md) => (
                        <button
                            key={md}
                            onClick={() => setMode(md)}
                            title={md === "ask" ? "Ask questions (read-only)" : "Make edits (review before applying)"}
                            className={`px-2 py-0.5 text-[11px] rounded-[var(--radius-sm)] capitalize transition-colors ${mode === md ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                        >
                            {md}
                        </button>
                    ))}
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
                {!configured ? (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-sm text-[var(--text-secondary)]">
                        <span className="material-symbols-outlined text-[32px] opacity-40">key</span>
                        <p>Connect an AI provider to start chatting about your note.</p>
                        <button
                            onClick={() => window.dispatchEvent(new CustomEvent("paperling:open-settings"))}
                            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
                        >
                            Open AI settings
                        </button>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-1.5 px-6">
                        <img
                            src={mascotWizard}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            className="w-24 h-24 object-contain select-none mb-1"
                        />
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                            {mode === "agent" ? "What should I change?" : "Ask about this note"}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                            {mode === "agent"
                                ? "I'll propose edits you can review and accept."
                                : "Summaries, questions, suggestions, anything."}
                        </p>
                    </div>
                ) : (
                    messages.map((m, i) => (
                        <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                            {m.role === "user" ? (
                                <div className="max-w-[85%] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] text-sm whitespace-pre-wrap break-words">
                                    {m.content}
                                </div>
                            ) : (
                                <div className="max-w-[92%] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm w-full">
                                    {m.content ? (
                                        <div className="markdown-body !text-sm [&_*]:!text-sm [&_h1]:!text-base [&_h2]:!text-sm [&_pre]:!text-xs">
                                            <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                                        </div>
                                    ) : (
                                        <span className="inline-flex gap-1 text-[var(--text-muted)]">
                                            <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                                            Thinking…
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
                {error && (
                    <div className="px-3 py-2 text-xs text-[var(--danger)] bg-[var(--danger)]/10 rounded-[var(--radius-sm)] whitespace-pre-wrap">{error}</div>
                )}
            </div>

            {/* Input */}
            {configured && (
                <div className="shrink-0 p-3 pt-2">
                    <div className="ai-composer flex items-end gap-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-lg)] px-3 py-2 shadow-sm transition-all duration-150">
                        {/* Uncontrolled on purpose: a controlled textarea has React
                            re-assign value/defaultValue on renders, which WebKitGTK
                            treats as a programmatic edit and purges the native undo
                            stack — Ctrl+Z stopped working on Linux (#111). `input`
                            is a read-only mirror kept via onChange. */}
                        <textarea
                            ref={inputRef}
                            defaultValue=""
                            onChange={(e) => { inputDraftRef.current = e.target.value; setInput(e.target.value); }}
                            onKeyDown={onKeyDown}
                            rows={1}
                            placeholder={mode === "agent" ? "Describe the change…" : "Ask about this note…"}
                            className="flex-1 block w-full bg-transparent text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:outline-none focus-visible:outline-none resize-none placeholder:text-[var(--text-muted)] py-0.5"
                        />
                        {busy ? (
                            <button onClick={stop} title="Stop" aria-label="Stop generating" className="shrink-0 w-8 h-8 rounded-[var(--radius-md)] bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center justify-center hover:bg-[var(--border)] transition-colors">
                                <span className="material-symbols-outlined text-[18px]">stop</span>
                            </button>
                        ) : (
                            <button onClick={send} disabled={!input.trim()} title="Send (Enter)" aria-label="Send" className="shrink-0 w-8 h-8 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] flex items-center justify-center enabled:hover:opacity-90 enabled:active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                            </button>
                        )}
                    </div>
                    <p className="px-1 pt-1.5 text-[10px] text-[var(--text-muted)] no-select">
                        {IS_MOBILE ? (
                            "Tap ➤ to send"
                        ) : (
                            <>
                                <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> for newline
                            </>
                        )}
                    </p>
                </div>
            )}
        </aside>
    );
}
