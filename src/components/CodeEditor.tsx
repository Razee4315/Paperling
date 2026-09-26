import { useRef, useCallback, useEffect, useLayoutEffect, useState, useMemo, memo } from "react";
import { EditorState as CMEditorState, EditorSelection, Compartment, Prec, type Extension, type StateEffect } from "@codemirror/state";
import { selectNextOccurrence, highlightSelectionMatches } from "@codemirror/search";
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    type ViewUpdate,
} from "@codemirror/view";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, type CompletionResult, type Completion } from "@codemirror/autocomplete";
import { unifiedMergeView, getChunks, getOriginalDoc } from "@codemirror/merge";
import { vim } from "@replit/codemirror-vim";
import { tags as t } from "@lezer/highlight";
import { getImageFromClipboard, saveImageToFile, createMarkdownImage } from "../utils/imageUtils";
import {
    handleTab,
    handleEnter,
    wrapSelection,
    insertLink,
    toggleTask,
    type EditorResult,
    type EditorState,
} from "../utils/editorActions";
import { FindBar, findSeedFromSelection, type FindController, type FindOpts } from "./FindBar";
import { replaceOne, replaceAllMatches, isValidPattern } from "../utils/findReplace";
import { findHighlightField, setFindMatches } from "../utils/editorFindHighlight";
import {
    collectUnifiedMatches,
    docRanges,
    activeDocIndex,
    replaceableOffsets,
    type DeletedRegion,
    type UnifiedMatch,
} from "../utils/reviewFind";
import {
    highlightRemovedMatch,
    clearRemovedHighlight,
    deletedChunkElementAt,
} from "../utils/reviewFindHighlight";
import { FormatToolbar } from "./FormatToolbar";
import { SlashMenu, type SlashCommand } from "./SlashMenu";
import { AIBubble } from "./AIBubble";
import { TableToolbar } from "./TableToolbar";
import { pasteUrlOnSelection, pasteUrlAutolink, pasteTsvAsTable, htmlToMarkdown } from "../utils/smartPaste";
import { getAIEnabled } from "../utils/persistence";
import { invoke } from "@tauri-apps/api/core";
import { matchWikilinkPrefix, rankFileNames, toWikiName } from "../utils/wikilinkComplete";
import { applyTableOp, findTableAt, locateCell, type Align } from "../utils/tableModel";
import { toCmKey, isMac } from "../config/keybindings";
import { linkAt, type EditorLink } from "../utils/editorLinks";
import { locateText } from "../utils/revealText";
import { highlightCaretLine } from "../utils/caretLineHighlight";
import type { HandoffOptions, Scroller } from "../utils/scrollSync";

interface CodeEditorProps {
    content: string;
    onChange: (content: string) => void;
    onCursorChange?: (line: number, column: number) => void;
    onSelectionChange?: (start: number, end: number) => void;
    onImagePaste?: () => void;
    onError?: (message: string) => void;
    onNotice?: (message: string) => void;
    filePath?: string | null;
    onScrollFraction?: (fraction: number) => void;
    registerScroller?: (scroller: Scroller | null) => void;
    typewriterMode?: boolean;
    showToolbar?: boolean;
    wordWrap?: boolean;
    spellCheck?: boolean;
    /** Centre the text in a ~80-character column (Settings → Readable line
     *  length), matching the preview. Only applies while word wrap is on. */
    readableLineLength?: boolean;
    /** Optional vim modal editing (issue #119): h/j/k/l, modes, operators —
     *  the official @replit/codemirror-vim implementation. Off by default. */
    vimMode?: boolean;
    aiConfig?: { endpoint: string; model: string; apiKey: string };
    /** When non-null, show this proposed document as an inline diff (CodeMirror
     *  merge view) for the user to accept/reject. Null = no review in progress. */
    reviewDoc?: string | null;
    /** Called when the user finishes a review: the final document (accept) or
     *  null (rejected everything — keep the original). */
    onReviewResolve?: (finalDoc: string | null) => void;
    /** Bumped by App on every genuine document SWAP (tab switch, file open, new
     *  file) — as opposed to an in-document edit. On each bump the editor clears
     *  its undo history so Ctrl+Z can't reach back into the previous document (a
     *  data-loss bug: undo used to "un-swap" the file). TABS-03. */
    docSwapId?: number;
    /** Identity of the document on screen (the tab id). Each document keeps
     *  its own editor state (caret, selection, scroll and undo history) so
     *  switching tabs and back is lossless. TABS-20. */
    docKey?: string | null;
    /** Ctrl/Cmd+click on a link in the source follows it. NAV-11. */
    onOpenLink?: (link: EditorLink) => void;
}

/**
 * CodeMirror's default keymap, minus the unshifted Alt+←/→ on Windows/Linux.
 * There CM binds them to cursorSyntaxLeft/Right, and handling a key calls
 * preventDefault — which the app's window handler (SHC-01) treats as
 * "already handled", so Alt+←/→ stopped switching tabs whenever the editor
 * had focus. Shift+Alt+←/→ (select by syntax node) keeps working, and macOS
 * is untouched (its binding is Ctrl+←/→ and Option+Arrows move by word).
 * SHC-09.
 */
const editorDefaultKeymap = isMac
    ? defaultKeymap
    : defaultKeymap.map((binding) =>
          binding.key === "Alt-ArrowLeft" || binding.key === "Alt-ArrowRight"
              ? { ...binding, run: undefined }
              : binding,
      );

const EDITOR_FONT_FAMILY =
    "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

// Markdown syntax colours, driven by the same CSS variables the rest of the app
// themes with — so light/dark/paper/dracula all "just work" in the editor too.
const markdownHighlight = HighlightStyle.define([
    { tag: t.heading1, color: "var(--syntax-h1)", fontWeight: "bold" },
    { tag: t.heading2, color: "var(--syntax-h2)", fontWeight: "bold" },
    { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--syntax-h3)", fontWeight: "600" },
    { tag: t.strong, color: "var(--syntax-bold)", fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: "var(--syntax-link)" },
    { tag: t.url, color: "var(--syntax-link)" },
    { tag: t.monospace, color: "var(--syntax-code)" },
    { tag: t.quote, color: "var(--syntax-quote)", fontStyle: "italic" },
    { tag: t.list, color: "var(--syntax-list)" },
    { tag: t.processingInstruction, color: "var(--syntax-list)" },
]);

const editorTheme = EditorView.theme({
    "&": {
        height: "100%",
        color: "var(--text-primary)",
        backgroundColor: "var(--bg-editor)",
        // Follows Settings → Font size (was a hardcoded 14px, so the setting
        // never touched the editor). Line height scales with it.
        fontSize: "var(--editor-font-size, 14px)",
    },
    ".cm-scroller": {
        fontFamily: EDITOR_FONT_FAMILY,
        lineHeight: "1.72",
        overflow: "auto",
    },
    ".cm-content": {
        caretColor: "var(--accent)",
        // Room at the end so the last lines can scroll clear of the
        // floating mode pill (bottom-right) instead of ending under it.
        // RLL-04.
        padding: "16px 0 112px",
    },
    ".cm-gutters": {
        backgroundColor: "var(--bg-gutter)",
        color: "var(--text-muted)",
        border: "none",
        borderRight: "1px solid var(--border-subtle)",
    },
    // Fully opaque again: highlightCaretLine drops this decoration entirely
    // while a selection exists, so it can no longer paint over the selection
    // layer, and the caret-only case gets a line tint you can actually see.
    ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-primary)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--selection-bg)",
    },
    // CodeMirror's base theme paints the FOCUSED selection through a
    // higher-specificity selector (&light.cm-focused > .cm-scroller > ...), so
    // without this mirror rule every theme showed the CM default lavender —
    // near-invisible against light-theme text. Selected-text color comes from
    // the global ::selection rule in index.css.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: "var(--selection-bg)",
    },
    ".cm-foldPlaceholder": { backgroundColor: "var(--bg-hover)", color: "var(--text-secondary)", border: "none" },
});

/** Bold/italic across several cursors (Ctrl+D): wrap every range. Returns
 *  false for a single range so the tested single-range toggle handles it. */
function wrapEachRange(view: EditorView, mark: string): boolean {
    if (view.state.selection.ranges.length < 2) return false;
    view.dispatch(
        view.state.changeByRange((r) => ({
            changes: [
                { from: r.from, insert: mark },
                { from: r.to, insert: mark },
            ],
            range: EditorSelection.range(r.from + mark.length, r.to + mark.length),
        })),
    );
    return true;
}

/**
 * Typing an emphasis marker over a selection wraps it instead of replacing
 * it (`*` → *text*, `_`, `~`, `=` for ==highlight==), like Typora. The
 * cheatsheet promised this for years, backed by helpers that were never
 * wired; closeBrackets already covers brackets and quotes. EDIT-01.
 */
const WRAP_ON_TYPE = new Set(["*", "_", "~", "="]);
const wrapSelectionOnType = EditorView.inputHandler.of((view, from, to, text) => {
    if (!WRAP_ON_TYPE.has(text) || from === to) return false;
    const { ranges } = view.state.selection;
    if (ranges.some((r) => r.empty)) return false;
    view.dispatch(
        view.state.changeByRange((r) => ({
            changes: [
                { from: r.from, insert: text },
                { from: r.to, insert: text },
            ],
            range: EditorSelection.range(r.from + 1, r.to + 1),
        })),
        { userEvent: "input.type" },
    );
    return true;
});

/** Build the EditorState shape the (tested) editorActions helpers expect. */
function toEdState(view: EditorView): EditorState {
    const s = view.state.selection.main;
    return { text: view.state.doc.toString(), selStart: s.from, selEnd: s.to };
}

/** Smallest single replacement turning `old` into `next`: diff the common
 *  prefix/suffix so CodeMirror only touches what actually changed. */
function minimalDiff(old: string, next: string): { from: number; to: number; insert: string } {
    let p = 0;
    const maxP = Math.min(old.length, next.length);
    while (p < maxP && old.charCodeAt(p) === next.charCodeAt(p)) p++;
    let s = 0;
    const maxS = Math.min(old.length - p, next.length - p);
    while (s < maxS && old.charCodeAt(old.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
    return { from: p, to: old.length - s, insert: next.slice(p, next.length - s) };
}

/** Apply an EditorResult (full new text + selection) as a MINIMAL change
 *  (keeps undo granular and avoids full-doc churn). Selection is set atomically,
 *  so there's no one-frame caret flicker (fixes the old rAF restore). */
function applyResultToView(view: EditorView, r: EditorResult) {
    view.dispatch({
        changes: minimalDiff(view.state.doc.toString(), r.text),
        selection: { anchor: r.selStart, head: r.selEnd },
        scrollIntoView: true,
    });
}

function CodeEditorImpl({
    content,
    onChange,
    onCursorChange,
    onSelectionChange,
    onImagePaste,
    onError,
    onNotice,
    filePath,
    onScrollFraction,
    registerScroller,
    typewriterMode,
    showToolbar,
    wordWrap = true,
    spellCheck = false,
    vimMode = false,
    readableLineLength = false,
    aiConfig,
    reviewDoc,
    onReviewResolve,
    docSwapId,
    docKey = null,
    onOpenLink,
}: CodeEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    const [findOpen, setFindOpen] = useState(false);
    const [findMode, setFindMode] = useState<"find" | "replace">("find");
    // Each open request (incl. a repeat Ctrl+F) carries the selection to
    // search for. FIND-06/07.
    const [findRequest, setFindRequest] = useState<{ nonce: number; text?: string }>({ nonce: 0 });
    const requestFind = useCallback((mode: "find" | "replace") => {
        const v = viewRef.current;
        const sel = v?.state.selection.main;
        const text = v && sel && !sel.empty ? v.state.sliceDoc(sel.from, sel.to) : undefined;
        setFindMode(mode);
        setFindOpen(true);
        setFindRequest((r) => ({ nonce: r.nonce + 1, text: findSeedFromSelection(text) }));
    }, []);
    const requestFindRef = useRef(requestFind);
    requestFindRef.current = requestFind;
    const [slashState, setSlashState] = useState<{ from: number; pos: { x: number; y: number } } | null>(null);
    const [slashQuery, setSlashQuery] = useState("");
    const [aiBubble, setAIBubble] = useState<{ x: number; y: number; selStart: number; selEnd: number; text: string } | null>(null);
    const [reviewActive, setReviewActive] = useState(false);
    // Floating table toolbar: set when the caret is inside a markdown table.
    const [tableUI, setTableUI] = useState<{ x: number; y: number; align: Align } | null>(null);

    // Latest props read by the once-created CodeMirror extensions, kept in refs so
    // the view never has to be torn down and rebuilt on a callback/flag change.
    const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
    const onCursorChangeRef = useRef(onCursorChange); onCursorChangeRef.current = onCursorChange;
    const onSelectionChangeRef = useRef(onSelectionChange); onSelectionChangeRef.current = onSelectionChange;
    const onScrollFractionRef = useRef(onScrollFraction); onScrollFractionRef.current = onScrollFraction;
    const onImagePasteRef = useRef(onImagePaste); onImagePasteRef.current = onImagePaste;
    const onErrorRef = useRef(onError); onErrorRef.current = onError;
    const onNoticeRef = useRef(onNotice); onNoticeRef.current = onNotice;
    const onReviewResolveRef = useRef(onReviewResolve); onReviewResolveRef.current = onReviewResolve;
    const onOpenLinkRef = useRef(onOpenLink); onOpenLinkRef.current = onOpenLink;
    const filePathRef = useRef(filePath); filePathRef.current = filePath;
    // One-shot latch for Ctrl+Shift+V ("paste as plain text"): the keydown sets
    // it, the very next paste event consumes it and skips HTML conversion
    // (PASTE-03).
    const forcePlainTextRef = useRef(false);
    // Base names (without .md) of the sibling files, for `[[` autocomplete. Kept
    // in a ref so the once-created completion source always sees the latest list.
    const wikiNamesRef = useRef<string[]>([]);
    const aiConfigRef = useRef(aiConfig); aiConfigRef.current = aiConfig;
    const typewriterRef = useRef(typewriterMode); typewriterRef.current = typewriterMode;
    const slashStateRef = useRef(slashState); slashStateRef.current = slashState;
    // The range the AI bubble will act on, MAPPED through every later edit.
    // It used to be the raw offsets captured when the bubble opened, so typing
    // while the model generated made Replace splice the wrong text. Null when
    // no bubble is open. AI-06.
    const aiRangeRef = useRef<{ from: number; to: number; text: string } | null>(null);

    // The last value WE emitted via onChange — lets the external-content sync
    // effect below skip the O(n) doc.toString() comparison on the common case
    // (the prop change is just our own keystroke echoing back through App state).
    const lastEmittedRef = useRef(content);
    // Live mirror of the `content` prop, read by the doc-swap effect without
    // making `content` one of its deps (it must fire ONLY on docSwapId).
    const contentPropRef = useRef(content);
    contentPropRef.current = content;

    // Per-document editor states, keyed by docKey (TABS-20). A tab switch
    // stores the outgoing EditorState (it carries the undo history, the
    // selection and every extension's state) plus its scroll offset, and
    // restores the incoming one when its text still matches. Before, every
    // switch replaced the text wholesale and wiped the history: the caret
    // jumped to the start of its line, the viewport jumped, and Ctrl+Z no
    // longer worked after looking at another tab.
    const stateCacheRef = useRef(new Map<string, { state: CMEditorState; scroll: StateEffect<unknown> }>());
    const docKeyRef = useRef(docKey);
    docKeyRef.current = docKey;
    const shownKeyRef = useRef(docKey);
    const appliedSwapRef = useRef(docSwapId);
    // Set when a swap restored a cached state; the tab-restore goto-line /
    // scroll-top that useFileSession fires for the same switch is then
    // skipped, or it would throw away the exact position just restored.
    const restoredFromCacheRef = useRef(false);
    // Live setting values for rebuilding extensions on a restored state.
    const liveSettingsRef = useRef({ wordWrap, spellCheck, vimMode });
    liveSettingsRef.current = { wordWrap, spellCheck, vimMode };
    const buildEditingKeymapRef = useRef<() => Extension>(() => []);

    // Reconfigurable extensions.
    const wrapCompRef = useRef(new Compartment());
    const spellCompRef = useRef(new Compartment());
    // Vim modal editing (issue #119) — toggled live from Settings.
    const vimCompRef = useRef(new Compartment());
    // history() lives in a compartment so a document swap can reset undo state
    // (reconfigure to [] then back) without rebuilding the whole editor. TABS-03.
    const historyCompRef = useRef(new Compartment());
    // The editing keymap (bold/italic/find/…), rebuilt on rebinds. SHC-10.
    const keymapCompRef = useRef(new Compartment());
    // AI review (merge view) state.
    const mergeCompRef = useRef(new Compartment());
    const reviewingRef = useRef(false);
    const reviewOriginalRef = useRef("");
    const lastReviewRef = useRef<string | null>(null);
    // Whether the current review has ever reported at least one chunk. Guards
    // against a false "all resolved" completion: right after entering review the
    // merge field can momentarily report 0 chunks before it computes them.
    const reviewHadChunksRef = useRef(false);

    // `[[` autocomplete: when the caret is inside an open wikilink target, offer
    // the folder's other markdown files. Reads wikiNamesRef (refreshed below) so
    // the once-created editor always sees the current list. NAV-06.
    const wikiCompletionSource = useCallback((context: CompletionContext): CompletionResult | null => {
        const line = context.state.doc.lineAt(context.pos);
        const textBefore = line.text.slice(0, context.pos - line.from);
        const m = matchWikilinkPrefix(textBefore);
        if (!m) return null;
        const names = rankFileNames(wikiNamesRef.current, m.query);
        if (names.length === 0) return null;
        const from = line.from + m.from;
        // closeBrackets usually inserts `]]` already; only add it if it's missing.
        const hasClose = context.state.doc.sliceString(context.pos, context.pos + 2) === "]]";
        const options: Completion[] = names.map((name) => ({
            label: name,
            type: "text",
            apply: (view: EditorView, _c: Completion, fromPos: number, toPos: number) => {
                const insert = hasClose ? name : `${name}]]`;
                view.dispatch({
                    changes: { from: fromPos, to: toPos, insert },
                    // Land the caret just past the closing `]]`.
                    selection: { anchor: fromPos + name.length + 2 },
                });
            },
        }));
        return { from, options, validFor: /^[^\]\n|]*$/ };
    }, []);

    // Refresh the sibling-file list for `[[` autocomplete when the open file (and
    // thus its folder) changes, and when the window regains focus (files may have
    // been added/removed elsewhere). Excludes the open file itself.
    useEffect(() => {
        let cancelled = false;
        const fp = filePath;
        const norm = fp ? fp.replace(/\\/g, "/") : "";
        const lastSlash = norm.lastIndexOf("/");
        const dir = fp && lastSlash > 0 ? fp.slice(0, lastSlash) : null;
        if (!dir) { wikiNamesRef.current = []; return; }
        const load = () => {
            invoke<{ name: string; path: string }[]>("list_directory_files", { directory: dir })
                .then((entries) => {
                    if (cancelled) return;
                    wikiNamesRef.current = entries
                        .filter((e) => e.path !== fp)
                        .map((e) => toWikiName(e.name))
                        .filter(Boolean);
                })
                .catch(() => { if (!cancelled) wikiNamesRef.current = []; });
        };
        load();
        window.addEventListener("focus", load);
        return () => { cancelled = true; window.removeEventListener("focus", load); };
    }, [filePath]);

    const openAIBubble = useCallback(() => {
        const view = viewRef.current;
        if (!view) return;
        if (!aiConfigRef.current?.endpoint) {
            onNoticeRef.current?.("AI isn't set up yet: add an endpoint in Settings, AI section, to enable AI assist.");
            return;
        }
        const sel = view.state.selection.main;
        if (sel.from === sel.to) {
            // Every remaining AI action needs a selection; opening the bubble with
            // an empty selection would show no action buttons at all.
            onNoticeRef.current?.("Select some text to use AI assist.");
            return;
        }
        const coords = view.coordsAtPos(sel.head);
        const rect = view.scrollDOM.getBoundingClientRect();
        const x = coords ? coords.left : rect.left + 28;
        const y = (coords ? coords.bottom : rect.top + 24) + 6;
        aiRangeRef.current = { from: sel.from, to: sel.to, text: view.state.doc.sliceString(sel.from, sel.to) };
        setAIBubble({ x, y, selStart: sel.from, selEnd: sel.to, text: view.state.doc.sliceString(sel.from, sel.to) });
    }, []);

    // === One-time CodeMirror setup ===
    useEffect(() => {
        if (!containerRef.current) return;

        const wrapComp = wrapCompRef.current;
        const spellComp = spellCompRef.current;
        const vimComp = vimCompRef.current;
        const mergeComp = mergeCompRef.current;
        const historyComp = historyCompRef.current;
        const keymapComp = keymapCompRef.current;

        // Built from the (user-overridable) binding config and kept in a
        // compartment, so a rebind in Settings → Shortcuts applies to the
        // open editor immediately. SHC-10.
        const buildEditingKeymap = () => Prec.highest(keymap.of([
            { key: "Tab", run: (v) => runAction(v, (st) => handleTab(st, false)), shift: (v) => runAction(v, (st) => handleTab(st, true)) },
            { key: "Enter", run: (v) => runAction(v, handleEnter) },
            { key: toCmKey("bold"), run: (v) => wrapEachRange(v, "**") || (applyResultToView(v, wrapSelection(toEdState(v), "**", "**", "bold")), true) },
            { key: toCmKey("italic"), run: (v) => wrapEachRange(v, "*") || (applyResultToView(v, wrapSelection(toEdState(v), "*", "*", "italic")), true) },
            // Ctrl+D: add the next occurrence of the selection/word as another
            // cursor (VS Code). @codemirror/search was bundled but unused.
            { key: toCmKey("selectNextOccurrence"), run: selectNextOccurrence, preventDefault: true },
            { key: toCmKey("link"), run: (v) => { applyResultToView(v, insertLink(toEdState(v))); return true; } },
            // Ctrl/Cmd+Enter ticks the task on the caret line(s). TASK-01.
            { key: toCmKey("toggleTask"), run: (v) => runAction(v, toggleTask) },
            {
                key: toCmKey("blockquote"), run: (v) => {
                    const st = toEdState(v);
                    const ls = st.text.lastIndexOf("\n", st.selStart - 1) + 1;
                    const lineEnd = st.text.indexOf("\n", st.selStart);
                    const end = lineEnd === -1 ? st.text.length : lineEnd;
                    const line = st.text.slice(ls, end);
                    const quoted = line.startsWith("> ");
                    const newLine = quoted ? line.slice(2) : "> " + line;
                    const delta = newLine.length - line.length;
                    applyResultToView(v, { text: st.text.slice(0, ls) + newLine + st.text.slice(end), selStart: st.selStart + delta, selEnd: st.selEnd + delta });
                    return true;
                }
            },
            { key: toCmKey("find"), run: () => { requestFindRef.current("find"); return true; } },
            { key: toCmKey("replace"), run: () => { requestFindRef.current("replace"); return true; } },
            // NB: the AI shortcut (Alt+J / ⌘J) is handled at the App window level
            // so it fires regardless of editor focus — see App.tsx. The editor
            // opens the bubble via the paperling:ai-assist event listener below.
        ]));

        buildEditingKeymapRef.current = buildEditingKeymap;

        const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
            if (reviewingRef.current) {
                // During an AI review the editor shows the full PROPOSED text, but
                // the preview should show "original + the changes accepted so far".
                // @codemirror/merge's acceptChunk folds an accepted change into its
                // original document (rejectChunk reverts the editor doc instead), so
                // getOriginalDoc() IS exactly that running result — sync it to the
                // preview so accepting/rejecting a single change updates it live.
                let accepted: string | null = null;
                try { accepted = getOriginalDoc(update.state).toString(); } catch { /* merge field not ready */ }
                if (accepted !== null && accepted !== lastEmittedRef.current) {
                    lastEmittedRef.current = accepted;
                    onChangeRef.current?.(accepted);
                }
                // Detect when the user has resolved every chunk individually via the
                // gutter buttons (Accept-all/Reject-all clear reviewingRef themselves).
                // NOT gated on docChanged: accepting a chunk folds the change into the
                // merge view's ORIGINAL side and leaves the editor doc unchanged
                // (docChanged = false), so accepting every chunk one-by-one would never
                // be observed if we only ran this on doc-changing updates. Rejecting a
                // chunk does change the doc, but running unconditionally covers both.
                let chunkCount = -1;
                try { chunkCount = getChunks(update.state)?.chunks.length ?? -1; } catch { /* merge field not ready */ }
                if (chunkCount > 0) reviewHadChunksRef.current = true;
                // Only finalize AFTER we've seen at least one chunk: the merge
                // field can briefly report 0 chunks right after entering review.
                if (reviewHadChunksRef.current && chunkCount === 0) {
                    // Defer: dispatching synchronously from inside the update
                    // listener is re-entrant and unsafe. Re-check in the rAF that
                    // nothing else (a manual Accept/Reject-all) resolved it first.
                    requestAnimationFrame(() => {
                        const v = viewRef.current;
                        if (!v || !reviewingRef.current) return;
                        let stillZero = false;
                        try { stillZero = (getChunks(v.state)?.chunks.length ?? -1) === 0; } catch { /* ignore */ }
                        if (stillZero) finishReview(v.state.doc.toString());
                    });
                }
            } else if (update.docChanged) {
                const range = aiRangeRef.current;
                if (range) {
                    aiRangeRef.current = {
                        ...range,
                        from: update.changes.mapPos(range.from, 1),
                        to: Math.max(update.changes.mapPos(range.from, 1), update.changes.mapPos(range.to, -1)),
                    };
                }
                const value = update.state.doc.toString();
                lastEmittedRef.current = value;
                onChangeRef.current?.(value);
            }
            if (update.selectionSet || update.docChanged) {
                const head = update.state.selection.main.head;
                const line = update.state.doc.lineAt(head);
                onCursorChangeRef.current?.(line.number, head - line.from + 1);
                const sel = update.state.selection.main;
                onSelectionChangeRef.current?.(sel.from, sel.to);
                // Opening the menu is a TYPING affordance: a pure caret move
                // must never open it, or clicking after an existing "/table"
                // in prose armed Enter to rewrite the sentence. SLASH-02.
                detectSlash(update.view, update.docChanged && update.transactions.some((tr) => tr.isUserEvent("input.type")));
                detectTable(update.view);
                // Typewriter mode: recenter only while TYPING (docChanged), not on
                // mouse clicks / arrow navigation — clicking shouldn't yank the
                // viewport around.
                if (typewriterRef.current && update.docChanged) {
                    const pos = head;
                    requestAnimationFrame(() => {
                        const v = viewRef.current;
                        if (v) v.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
                    });
                }
            }
        });

        // Ctrl/Cmd+click follows the link under the pointer (NAV-11); while
        // the modifier is held, links show a pointer cursor as the hint.
        const modHeld = (e: MouseEvent) => (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
        const linkUnder = (view: EditorView, e: MouseEvent) => {
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return null;
            const line = view.state.doc.lineAt(pos);
            return linkAt(line.text, pos - line.from);
        };
        const pasteHandler = EditorView.domEventHandlers({
            paste: (event, view) => handlePaste(event, view),
            mousedown: (event, view) => {
                if (event.button !== 0 || !modHeld(event) || !onOpenLinkRef.current) return false;
                const link = linkUnder(view, event);
                if (!link) return false;
                event.preventDefault();
                onOpenLinkRef.current(link);
                return true;
            },
            mousemove: (event, view) => {
                const pointer = modHeld(event) && !!onOpenLinkRef.current && !!linkUnder(view, event);
                const want = pointer ? "pointer" : "";
                if (view.contentDOM.style.cursor !== want) view.contentDOM.style.cursor = want;
                return false;
            },
        });

        // Arm the paste-as-plain-text latch (PASTE-03). One listener for the
        // editor's lifetime; it only flips a flag.
        const onPasteShortcutKeydown = (e: KeyboardEvent) => {
            const mod = isMac ? e.metaKey : e.ctrlKey;
            if (mod && e.shiftKey && !e.altKey && (e.key === "v" || e.key === "V")) {
                forcePlainTextRef.current = true;
            }
        };
        window.addEventListener("keydown", onPasteShortcutKeydown);

        const view = new EditorView({
            parent: containerRef.current,
            state: CMEditorState.create({
                doc: content,
                extensions: [
                    lineNumbers(),
                    highlightActiveLineGutter(),
                    // Not CodeMirror's highlightActiveLine: ours yields while a
                    // selection is up, so the line tint can't hide it (#146).
                    highlightCaretLine,
                    historyComp.of(history()),
                    drawSelection(),
                    dropCursor(),
                    closeBrackets(),
                    wrapSelectionOnType,
                    // Multiple cursors (Ctrl+D, Ctrl/Cmd+click). Without this
                    // facet CodeMirror silently keeps only the main range.
                    CMEditorState.allowMultipleSelections.of(true),
                    autocompletion({ override: [wikiCompletionSource], icons: false, aboveCursor: false }),
                    markdown(),
                    syntaxHighlighting(markdownHighlight),
                    findHighlightField,
                    // Other occurrences of the selected word get a subtle
                    // highlight, as in every code editor.
                    highlightSelectionMatches({ minSelectionLength: 2 }),
                    editorTheme,
                    wrapComp.of(wordWrap ? EditorView.lineWrapping : []),
                    spellComp.of(EditorView.contentAttributes.of(spellAttrs(spellCheck))),
                    vimComp.of(vimMode ? vim() : []),
                    mergeComp.of([]),
                    keymapComp.of(buildEditingKeymap()),
                    keymap.of([...closeBracketsKeymap, ...editorDefaultKeymap, ...historyKeymap]),
                    updateListener,
                    pasteHandler,
                    EditorView.theme({ "&": { outline: "none" } }),
                ],
            }),
        });
        viewRef.current = view;
        lastEmittedRef.current = content;
        view.focus();

        const onBindingsChanged = () =>
            view.dispatch({ effects: keymapComp.reconfigure(buildEditingKeymap()) });
        window.addEventListener("paperling:keybindings-changed", onBindingsChanged);

        return () => {
            window.removeEventListener("keydown", onPasteShortcutKeydown);
            window.removeEventListener("paperling:keybindings-changed", onBindingsChanged);
            view.destroy();
            viewRef.current = null;
        };
        // Created once; prop changes flow in via the effects + refs below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Helper used by the editing keymap: run a (tested) editorActions function and
    // apply its result, or fall through to CodeMirror's default if it returns null.
    function runAction(view: EditorView, fn: (st: EditorState) => EditorResult | null): boolean {
        // The (single-range) helpers would collapse a multi-cursor selection
        // to its main range; with several cursors, let CodeMirror's own
        // Enter / indent commands handle every range instead.
        if (view.state.selection.ranges.length > 1) return false;
        const r = fn(toEdState(view));
        if (!r) return false;
        applyResultToView(view, r);
        return true;
    }

    // Slash-command lifecycle, mirroring the previous textarea behaviour but
    // reading only the current line (no full-doc scans).
    function detectSlash(view: EditorView, typed: boolean) {
        const head = view.state.selection.main.head;
        const doc = view.state.doc;
        const cur = slashStateRef.current;
        if (cur) {
            if (head < cur.from + 1) { setSlashState(null); setSlashQuery(""); return; }
            const between = doc.sliceString(cur.from + 1, head);
            if (between.includes("\n") || between.includes(" ")) { setSlashState(null); setSlashQuery(""); return; }
            setSlashQuery(between);
            return;
        }
        // Everything below OPENS the menu — only for text the user just typed.
        if (!typed) return;
        if (head > 0 && doc.sliceString(head - 1, head) === "/") {
            const line = doc.lineAt(head);
            const lineHead = doc.sliceString(line.from, head - 1);
            if (lineHead === "" || /^\s*$/.test(lineHead) || /\s$/.test(lineHead)) {
                const coords = view.coordsAtPos(head - 1);
                if (coords) {
                    setSlashState({ from: head - 1, pos: { x: coords.left, y: coords.bottom + 4 } });
                    setSlashQuery("");
                }
            }
            return;
        }
        // Self-healing open: if a burst-typed "/query" (slash at line start,
        // no spaces after it) is at the caret but the open branch missed the
        // "/" keystroke — the slash state updates through React, so very fast
        // typing could process subsequent letters before the state/ref sync
        // landed and the menu never opened at all — re-arm it from the text
        // itself. SlashMenu's from-anchor makes selection still replace the
        // whole "/query" token. Only non-empty queries qualify (a bare "/"
        // typing straight through stays untouched). SLASH-01.
        {
            const line = doc.lineAt(head);
            const upToCaret = doc.sliceString(line.from, head);
            const slashIdx = upToCaret.lastIndexOf("/");
            if (slashIdx >= 0) {
                const before = upToCaret.slice(0, slashIdx);
                const query = upToCaret.slice(slashIdx + 1);
                if (
                    query.length > 0 &&
                    query.length <= 48 &&
                    !query.includes(" ") &&
                    (before === "" || /\s$/.test(before))
                ) {
                    const coords = view.coordsAtPos(line.from + slashIdx);
                    if (coords) {
                        setSlashState({ from: line.from + slashIdx, pos: { x: coords.left, y: coords.bottom + 4 } });
                        setSlashQuery(query);
                    }
                }
            }
        }
    }

    // Show the floating table toolbar when the caret is inside a markdown table.
    // Cheap guard first (current line has a pipe), then scan only the contiguous
    // run of pipe-containing lines around the caret. The old version called
    // doc.toString() here — a full-document copy on EVERY cursor move that
    // landed on a pipe line, which is megabytes per keystroke on a huge doc.
    function detectTable(view: EditorView) {
        if (reviewingRef.current) { setTableUI(null); return; }
        const head = view.state.selection.main.head;
        const doc = view.state.doc;
        const curLine = doc.lineAt(head);
        if (!curLine.text.includes("|")) { setTableUI(null); return; }

        // Expand to the surrounding block of pipe lines (capped — no real
        // markdown table is anywhere near 500 rows).
        const CAP = 500;
        let first = curLine.number;
        while (first > 1 && curLine.number - first < CAP && doc.line(first - 1).text.includes("|")) first--;
        let last = curLine.number;
        while (last < doc.lines && last - curLine.number < CAP && doc.line(last + 1).text.includes("|")) last++;

        const sliceFrom = doc.line(first).from;
        const slice = doc.sliceString(sliceFrom, doc.line(last).to);

        const region = findTableAt(slice, head - sliceFrom);
        if (!region) { setTableUI(null); return; }
        const { colIndex } = locateCell(region, head - sliceFrom);
        const coords = view.coordsAtPos(region.from + sliceFrom);
        if (!coords) { setTableUI(null); return; }
        setTableUI({ x: coords.left, y: coords.top, align: region.model.aligns[colIndex] ?? "none" });
    }

    function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
        const imageFile = getImageFromClipboard(event);
        if (imageFile) {
            event.preventDefault();
            if (!filePathRef.current) { onErrorRef.current?.("Please save your file first before pasting images."); return true; }
            (async () => {
                try {
                    const imagePath = await saveImageToFile(imageFile, filePathRef.current!);
                    const md = createMarkdownImage(imagePath, `image-${Date.now()}`);
                    const sel = view.state.selection.main;
                    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: md }, selection: { anchor: sel.from + md.length } });
                    onImagePasteRef.current?.();
                } catch (error) {
                    const msg = typeof error === "string" ? error : (error as { message?: string })?.message;
                    onErrorRef.current?.(msg || "Failed to save image. Please try again.");
                }
            })();
            return true;
        }
        const cd = event.clipboardData;
        if (!cd) return false;
        const html = cd.getData("text/html");
        const text = cd.getData("text/plain");
        const state = toEdState(view);

        const urlOnSel = pasteUrlOnSelection(state, text);
        if (urlOnSel) { event.preventDefault(); applyResultToView(view, urlOnSel); return true; }
        const autolink = pasteUrlAutolink(state, text);
        if (autolink) { event.preventDefault(); applyResultToView(view, autolink); return true; }
        // TSV→table runs BEFORE the HTML branch when the text flavor looks
        // like multi-cell spreadsheet data: Excel/Sheets put BOTH a <table>
        // and TSV on the clipboard, and turndown (no table rules) flattens
        // the HTML table into run-together text — the TSV table never stood a
        // chance. PASTE-02.
        const tsv = pasteTsvAsTable(state, text);
        if (tsv) { event.preventDefault(); applyResultToView(view, tsv); return true; }
        // Plain-text escape hatch: Ctrl+Shift+V set forcePlainTextRef on the
        // keydown preceding this paste — skip the HTML conversion entirely.
        // PASTE-03.
        if (html && /<\w+/.test(html) && !forcePlainTextRef.current) {
            event.preventDefault();
            // Capture the target range BEFORE any await: htmlToMarkdown lazily
            // imports turndown on first use, and reading the selection after
            // that await let a keystroke during the window make the paste
            // replace freshly typed text (PASTE-01).
            const sel = view.state.selection.main;
            const from = sel.from;
            const to = sel.to;
            (async () => {
                let insert = text;
                try { const md = (await htmlToMarkdown(html)).trim(); if (md) insert = md; } catch {/* fall back to plain text */ }
                // Only paste if the caret still covers the captured range; a
                // moved caret means the user kept editing — bailing out beats
                // deleting their work.
                const now = view.state.selection.main;
                if (now.from !== from || now.to !== to) return;
                view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
            })();
            return true;
        }
        forcePlainTextRef.current = false;
        return false; // let CodeMirror insert plain text
    }

    // Sync external content changes (file open, AI replace via App, preview
    // task-checkbox toggles, frontmatter edits) into the editor — skipping our
    // own keystroke echoes cheaply. Dispatch a minimal diff, NOT a whole-doc
    // replace: replacing the entire document maps CodeMirror's scroll anchor
    // to position 0, which yanked the editor (and, through split-mode scroll
    // sync, the preview) to the top every time a checkbox was clicked in the
    // preview (#111).
    useEffect(() => {
        if (content === lastEmittedRef.current) return;
        // A document swap is being committed in this same render: the swap
        // effect below owns it. Diffing the new file into the OLD state here
        // would record the swap in the outgoing tab's history and poison its
        // cached state. TABS-20.
        if (docSwapId !== appliedSwapRef.current) return;
        const view = viewRef.current;
        if (!view) return;
        const old = view.state.doc.toString();
        if (content !== old) {
            view.dispatch({ changes: minimalDiff(old, content) });
        }
        lastEmittedRef.current = content;
    }, [content]);

    // Reset undo history whenever App swaps the whole document for a different
    // file (tab switch, file open, new file). Without this, Ctrl+Z would undo
    // the swap itself and restore the PREVIOUS file's text into the current tab —
    // which autosave could then write to the wrong path. In-document edits
    // (checkbox toggles, AI, frontmatter) don't bump docSwapId, so they stay
    // undoable. Robust to effect order: if the content-sync effect above ran
    // first it recorded the swap in the OLD history, which we then discard; if it
    // hasn't run yet, `content` already equals the new doc so we set it here.
    // TABS-03.
    // useLayoutEffect: the swap lands in the same paint as the new tab, so
    // the previous note never flashes in the editor for a frame. SWITCH-01.
    useLayoutEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        if (appliedSwapRef.current === docSwapId) return;
        appliedSwapRef.current = docSwapId;
        const doc = contentPropRef.current;
        const cache = stateCacheRef.current;
        const outgoingKey = shownKeyRef.current;
        const incomingKey = docKeyRef.current;
        shownKeyRef.current = incomingKey;
        restoredFromCacheRef.current = false;

        if (outgoingKey && outgoingKey === incomingKey && !reviewingRef.current) {
            // Same document reloaded (external change, "Load from disk"):
            // apply the difference as an edit so the caret, the viewport and
            // the undo history survive; Ctrl+Z can even bring back what was
            // there before the reload, like VS Code. TABS-20.
            const old = view.state.doc.toString();
            if (doc !== old) view.dispatch({ changes: minimalDiff(old, doc) });
            lastEmittedRef.current = doc;
        } else {
            // Park the outgoing document's state (never mid-review: that state
            // carries the merge view of a proposal that is being discarded).
            if (outgoingKey && !reviewingRef.current) {
                cache.delete(outgoingKey);
                // scrollSnapshot() anchors the viewport to a document
                // position, not a pixel offset: setState rebuilds the height
                // map from estimates, so a raw scrollTop restored to the
                // wrong place on long documents.
                cache.set(outgoingKey, { state: view.state, scroll: view.scrollSnapshot() });
                // Bounded: closed tabs are never looked up again.
                while (cache.size > 40) cache.delete(cache.keys().next().value as string);
            }
            const cached = incomingKey ? cache.get(incomingKey) : undefined;
            if (cached && cached.state.doc.toString() === doc) {
                view.setState(cached.state);
                // The cached state was built with the settings of its time; the
                // user may have toggled wrap/spellcheck/vim or rebound keys since.
                const live = liveSettingsRef.current;
                view.dispatch({
                    effects: [
                        wrapCompRef.current.reconfigure(live.wordWrap ? EditorView.lineWrapping : []),
                        spellCompRef.current.reconfigure(EditorView.contentAttributes.of(spellAttrs(live.spellCheck))),
                        vimCompRef.current.reconfigure(live.vimMode ? vim() : []),
                        keymapCompRef.current.reconfigure(buildEditingKeymapRef.current()),
                        mergeCompRef.current.reconfigure([]),
                        cached.scroll,
                    ],
                });
                restoredFromCacheRef.current = true;
                const sel = view.state.selection.main;
                const line = view.state.doc.lineAt(sel.head);
                onCursorChangeRef.current?.(line.number, sel.head - line.from + 1);
                onSelectionChangeRef.current?.(sel.from, sel.to);
            } else {
                if (doc !== view.state.doc.toString()) {
                    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
                }
                // Reconfigure the history compartment to a fresh instance: the
                // documented way to clear CodeMirror's undo/redo stacks.
                view.dispatch({ effects: historyCompRef.current.reconfigure([]) });
                view.dispatch({ effects: historyCompRef.current.reconfigure(history()) });
            }
            lastEmittedRef.current = doc;
        }
        // Anything anchored to the previous document is now meaningless: an
        // open AI bubble would write its result into THIS file at the old
        // file's offsets (AI-06), and a slash menu would replace text here.
        aiRangeRef.current = null;
        setAIBubble(null);
        setSlashState(null);
        setSlashQuery("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docSwapId]);

    // Reconfigure word-wrap / spellcheck / vim when their props change.
    useEffect(() => {
        viewRef.current?.dispatch({ effects: wrapCompRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
    }, [wordWrap]);
    useEffect(() => {
        viewRef.current?.dispatch({ effects: spellCompRef.current.reconfigure(EditorView.contentAttributes.of(spellAttrs(spellCheck))) });
    }, [spellCheck]);
    useEffect(() => {
        viewRef.current?.dispatch({ effects: vimCompRef.current.reconfigure(vimMode ? vim() : []) });
    }, [vimMode]);

    // Enter / refresh / exit the AI review (CodeMirror unified merge view). The
    // original side is the document as it was BEFORE the proposal; the editor doc
    // becomes the proposed text, and the merge view shows per-change ✓/✗ controls.
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        if (reviewDoc != null) {
            if (reviewingRef.current && reviewDoc === lastReviewRef.current) return;
            if (!reviewingRef.current) {
                reviewOriginalRef.current = view.state.doc.toString();
                // Fresh review: reset the chunk-seen guard here (not on every
                // re-render) so a mid-review re-render can't reset it.
                reviewHadChunksRef.current = false;
            }
            reviewingRef.current = true;
            lastReviewRef.current = reviewDoc;
            setReviewActive(true);
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: reviewDoc },
                effects: mergeCompRef.current.reconfigure(unifiedMergeView({ original: reviewOriginalRef.current })),
            });
            // Bring the first proposed change into view so the user sees the diff
            // immediately instead of having to hunt for it (the change may be far
            // down a long document). Runs after the merge field computes chunks.
            requestAnimationFrame(() => {
                const v = viewRef.current;
                if (!v) return;
                const chunks = getChunks(v.state)?.chunks;
                if (chunks && chunks.length) {
                    v.dispatch({ effects: EditorView.scrollIntoView(chunks[0].fromB, { y: "center" }) });
                }
            });
        } else if (reviewingRef.current) {
            reviewingRef.current = false;
            lastReviewRef.current = null;
            setReviewActive(false);
            view.dispatch({ effects: mergeCompRef.current.reconfigure([]) });
        }
    }, [reviewDoc]);

    // Tear down the merge view and resolve with `final` (the current editor doc,
    // which — once every chunk is accepted/rejected — already equals the final
    // result). Shared by acceptAllChanges and the individual-resolve completion
    // path in the updateListener. Stable identity (reads only refs) so the
    // one-time updateListener can call it without going stale.
    const finishReview = useCallback((final: string) => {
        reviewingRef.current = false;
        lastReviewRef.current = null;
        reviewHadChunksRef.current = false;
        setReviewActive(false);
        // The removed lines are gone, so drop any find highlight pinned to them
        // rather than leave a stale registration behind (#111).
        clearRemovedHighlight();
        viewRef.current?.dispatch({ effects: mergeCompRef.current.reconfigure([]) });
        lastEmittedRef.current = final; // keep the App content-sync from re-dispatching
        onReviewResolveRef.current?.(final);
    }, []);

    const acceptAllChanges = useCallback(() => {
        const view = viewRef.current;
        if (!view) return;
        finishReview(view.state.doc.toString());
    }, [finishReview]);

    const rejectAllChanges = useCallback(() => {
        const view = viewRef.current;
        if (!view) return;
        const orig = reviewOriginalRef.current;
        reviewingRef.current = false;
        lastReviewRef.current = null;
        setReviewActive(false);
        clearRemovedHighlight();
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: orig },
            effects: mergeCompRef.current.reconfigure([]),
        });
        lastEmittedRef.current = orig;
        // Pass the original explicitly (not null): the preview was live-tracking the
        // accepted-so-far document during review, so we must reset it all the way
        // back, not leave it on a partially-accepted state.
        onReviewResolve?.(orig);
    }, [onReviewResolve]);

    // Scroll-fraction sync (rAF-throttled — PREVIEW-04) + imperative scroller.
    const scrollRafRef = useRef(0);
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const scroller = view.scrollDOM;
        const onScroll = () => {
            if (scrollRafRef.current) return;
            scrollRafRef.current = requestAnimationFrame(() => {
                scrollRafRef.current = 0;
                const max = scroller.scrollHeight - scroller.clientHeight;
                onScrollFractionRef.current?.(max > 0 ? scroller.scrollTop / max : 0);
            });
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            scroller.removeEventListener("scroll", onScroll);
            // Reset the id too: StrictMode (dev) remounts effects, and a stale
            // non-zero id made every later scroll bail out as "frame pending".
            if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
            scrollRafRef.current = 0;
        };
    }, []);

    useEffect(() => {
        if (!registerScroller) return;
        // Offset of the document's first line inside the scroller's content
        // (the content padding), so line heights map onto scrollTop.
        const docOffset = (view: EditorView) =>
            view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
        registerScroller({
            setFraction: (f: number) => {
                const view = viewRef.current;
                if (!view) return;
                const s = view.scrollDOM;
                const max = s.scrollHeight - s.clientHeight;
                if (max > 0) s.scrollTop = max * f;
            },
            // Line-anchored sync + mode handoff (SYNC-01 / MODE-01).
            getTopLine: () => {
                const view = viewRef.current;
                if (!view || view.scrollDOM.clientHeight === 0) return null; // hidden
                const h = Math.max(0, view.scrollDOM.scrollTop - docOffset(view));
                const block = view.lineBlockAtHeight(h);
                const line = view.state.doc.lineAt(block.from).number;
                const frac = block.height > 0 ? Math.min(1, Math.max(0, (h - block.top) / block.height)) : 0;
                return line + frac;
            },
            scrollToLine: (target: number, opts?: HandoffOptions) => {
                const view = viewRef.current;
                if (!view || view.scrollDOM.clientHeight === 0) return;
                const doc = view.state.doc;
                const n = Math.min(Math.max(1, Math.floor(target)), doc.lines);
                if (opts?.handoff) {
                    // The editor was just shown: its height map may be stale
                    // or estimated, so let CodeMirror resolve the scroll in
                    // its own measure cycle. A caret left somewhere off
                    // screen comes to the first visible line, or the next
                    // keystroke would yank the view back to it.
                    const first = Math.min(doc.lines, target - n > 0.5 ? n + 1 : n);
                    const lineStart = doc.line(first).from;
                    const topBlock = view.lineBlockAt(doc.line(n).from);
                    const viewportBottom = topBlock.top + view.scrollDOM.clientHeight;
                    const caretTop = view.lineBlockAt(view.state.selection.main.head).top;
                    const caretVisible = caretTop >= topBlock.top && caretTop < viewportBottom - 24;
                    view.dispatch({
                        ...(caretVisible ? {} : { selection: { anchor: lineStart } }),
                        effects: EditorView.scrollIntoView(doc.line(n).from, { y: "start", yMargin: 0 }),
                    });
                    if (opts.focus) view.focus();
                    return;
                }
                const frac = Math.max(0, target - Math.floor(target));
                const block = view.lineBlockAt(doc.line(n).from);
                view.scrollDOM.scrollTop = docOffset(view) + block.top + frac * block.height;
            },
        });
        return () => registerScroller(null);
    }, [registerScroller]);

    // Jump-to-line requests from the TOC / command palette (NAV-01). The editor
    // moves its caret and scrolls the line to the top; in preview-only mode this
    // pane is display:none so the scroll is a harmless no-op.
    useEffect(() => {
        const handler = (e: Event) => {
            // The tab switch already restored the exact caret and viewport.
            if ((e as CustomEvent).detail?.source === "tab-restore" && restoredFromCacheRef.current) return;
            const line = Number((e as CustomEvent).detail?.line);
            const v = viewRef.current;
            if (!v || !Number.isFinite(line) || line < 1) return;
            const docLine = v.state.doc.line(Math.min(Math.floor(line), v.state.doc.lines));
            v.dispatch({
                selection: { anchor: docLine.from },
                effects: EditorView.scrollIntoView(docLine.from, { y: "start", yMargin: 8 }),
            });
            // Outline clicks ask the visible editor to take focus. PANEL-01.
            if ((e as CustomEvent).detail?.focus && v.scrollDOM.clientHeight > 0) v.focus();
        };
        window.addEventListener("paperling:goto-line", handler);
        return () => window.removeEventListener("paperling:goto-line", handler);
    }, []);

    // Open the find / find-and-replace bar from outside the editor (the Edit
    // menu and command palette), mirroring the internal Mod-f / Mod-h keymap.
    // The editor's find bar has no other external trigger; this is the same
    // outside→editor idiom as paperling:goto-line above. The matching
    // paperling:close-find is the Android back handler's way in (see App.tsx).
    useEffect(() => {
        const openFind = () => requestFindRef.current("find");
        const openReplace = () => requestFindRef.current("replace");
        const closeFind = () => setFindOpen(false);
        window.addEventListener("paperling:open-find", openFind);
        window.addEventListener("paperling:open-replace", openReplace);
        window.addEventListener("paperling:close-find", closeFind);
        return () => {
            window.removeEventListener("paperling:open-find", openFind);
            window.removeEventListener("paperling:open-replace", openReplace);
            window.removeEventListener("paperling:close-find", closeFind);
        };
    }, []);

    // Mirror the find bar's open state onto `window` so the Android back
    // handler (App.tsx) can tell whether "close find" is a meaningful step
    // without owning this internal state. Cleanup covers unmount (which also
    // closes the bar — highlights are dropped by FindBar's own unmount effect).
    useEffect(() => {
        const w = window as unknown as { __paperlingEditorFindOpen?: boolean };
        w.__paperlingEditorFindOpen = findOpen;
        return () => { w.__paperlingEditorFindOpen = false; };
    }, [findOpen]);

    // Snap the caret and viewport to the start when a different file opens, so
    // you don't begin a new file at the previous file's cursor/scroll. NAV-04.
    useEffect(() => {
        const toTop = (e: Event) => {
            if ((e as CustomEvent).detail?.source === "tab-restore" && restoredFromCacheRef.current) return;
            const v = viewRef.current;
            if (!v) return;
            v.dispatch({
                selection: { anchor: 0 },
                effects: EditorView.scrollIntoView(0, { y: "start" }),
            });
            v.scrollDOM.scrollTop = 0;
        };
        window.addEventListener("paperling:scroll-top", toTop);
        // "Focus the document" (FOCUS-01): the visible editor takes focus.
        const focusDoc = () => {
            const v = viewRef.current;
            if (v && v.scrollDOM.clientHeight > 0) v.focus();
        };
        window.addEventListener("paperling:focus-document", focusDoc);
        // Reader -> Edit with a selection: select that text in the source.
        // MODE-03.
        const reveal = (e: Event) => {
            const v = viewRef.current;
            const detail = (e as CustomEvent).detail as { line?: number; text?: string } | undefined;
            if (!v || !detail?.text || v.scrollDOM.clientHeight === 0) return;
            const hit = locateText(v.state.doc.toString(), Math.max(1, detail.line ?? 1), detail.text);
            if (!hit) return;
            v.dispatch({
                selection: { anchor: hit.from, head: hit.to },
                effects: EditorView.scrollIntoView(hit.from, { y: "nearest", yMargin: 48 }),
            });
            v.focus();
        };
        window.addEventListener("paperling:reveal-text", reveal);
        return () => {
            window.removeEventListener("paperling:reveal-text", reveal);
            window.removeEventListener("paperling:scroll-top", toTop);
            window.removeEventListener("paperling:focus-document", focusDoc);
        };
    }, []);

    // Alt+J (and the command palette's "AI assist") is selection-aware, matching
    // the docs: with text selected it opens the inline selection-assist bubble;
    // with no selection it opens the docked AI side panel (chat about the doc).
    // App owns the panel's open state, so we ask it to toggle via an event.
    useEffect(() => {
        const handler = () => {
            // AI can be switched off entirely in Settings — Alt+J and the
            // command palette dispatch this event regardless, so gate here.
            if (!getAIEnabled()) return;
            const view = viewRef.current;
            if (!view) return;
            const sel = view.state.selection.main;
            if (sel.from !== sel.to) {
                view.focus();
                openAIBubble();
            } else {
                window.dispatchEvent(new CustomEvent("paperling:toggle-ai-panel"));
            }
        };
        window.addEventListener("paperling:ai-assist", handler);
        return () => window.removeEventListener("paperling:ai-assist", handler);
    }, [openAIBubble]);

    // Mirror of the Settings "Enable AI" switch; drives whether the format
    // toolbar shows its AI sparkle. Event-synced so flipping the setting
    // updates an already-mounted editor.
    const [aiEnabled, setAiEnabled] = useState(getAIEnabled);
    useEffect(() => {
        const h = (e: Event) => setAiEnabled(!!(e as CustomEvent).detail?.enabled);
        window.addEventListener("paperling:ai-enabled-toggle", h);
        return () => window.removeEventListener("paperling:ai-enabled-toggle", h);
    }, []);

    // === Imperative helpers for child UI (toolbar, find/replace, slash, AI) ===
    const getState = useCallback((): EditorState | null => {
        const v = viewRef.current;
        return v ? toEdState(v) : null;
    }, []);
    const applyResult = useCallback((r: EditorResult) => {
        const v = viewRef.current;
        if (v) { applyResultToView(v, r); v.focus(); }
    }, []);
    const insertAtCaret = useCallback((text: string) => {
        const v = viewRef.current;
        if (!v) return;
        const sel = v.state.selection.main;
        v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } });
        v.focus();
    }, []);

    // Editor adapter for the shared FindBar: match the live doc with the pure
    // findReplace helpers, paint matches via the findHighlightField decoration,
    // and replace through applyResultToView. Stable identity (refs + module-level
    // helpers only) so FindBar's effects don't churn.
    const findMatchesRef = useRef<UnifiedMatch[]>([]);
    // setActive() gets only an index, so the query that produced the matches is
    // stashed here for the removed-side highlighter to reuse.
    const findQueryRef = useRef({ query: "", caseSensitive: false });
        const editorFindController = useMemo<FindController>(() => {
        // During an AI review the document holds only the proposed text; the
        // removed original lines are merge widgets, absent from the document.
        // Feed them to the search as extra regions so a match the user can
        // plainly see is actually found. Outside review this is empty and the
        // search collapses to a plain document search. Issue #111.
        const removedRegions = (v: EditorView): { regions: DeletedRegion[]; original: string } => {
            if (!reviewingRef.current) return { regions: [], original: "" };
            const chunks = getChunks(v.state)?.chunks;
            if (!chunks?.length) return { regions: [], original: "" };
            return {
                original: getOriginalDoc(v.state).toString(),
                // A pure insertion has toA === fromA and renders no removed lines.
                regions: chunks
                    .filter((c) => c.toA > c.fromA)
                    .map((c) => ({ fromA: c.fromA, toA: c.toA, anchor: c.fromB })),
            };
        };
        const doSearch = (query: string, opts: FindOpts) => {
            const v = viewRef.current;
            if (!v) {
                findMatchesRef.current = [];
                return { count: 0, activeIndex: -1 };
            }
            const { regions, original } = removedRegions(v);
            const matches = collectUnifiedMatches(v.state.doc.toString(), original, regions, query, opts);
            findMatchesRef.current = matches;
            findQueryRef.current = { query, caseSensitive: opts.caseSensitive };
            clearRemovedHighlight();

            let activeIndex = -1;
            if (matches.length) {
                // Order by on-screen position, so `anchor` (not `from`, which
                // indexes the original doc for removed matches) is the cursor
                // comparison.
                const caret = v.state.selection.main.from;
                activeIndex = matches.findIndex((m) => m.anchor >= caret);
                if (activeIndex === -1) activeIndex = 0;
            }
            v.dispatch({ effects: setFindMatches.of({ ranges: docRanges(matches), activeIndex: -1 }) });
            return { count: matches.length, activeIndex };
        };
        return {
            supportsReplace: true,
            supportsRegex: true,
            isValidPattern: (query, opts) => isValidPattern(query, opts.regex),
            search: doSearch,
            setActive: (index) => {
                const v = viewRef.current;
                const matches = findMatchesRef.current;
                const m = matches[index];
                if (!v || !m) return;
                v.dispatch({
                    // The active match becomes the selection (VS Code): Esc
                    // then leaves you ON the found text, ready to type over
                    // it. It used to stay at the old caret, so the first
                    // keystroke after Esc yanked the view back there. FIND-08.
                    ...(m.side === "doc" ? { selection: { anchor: m.from, head: m.to } } : {}),
                    effects: [
                        // activeDocIndex, not `index`: the bar counts removed
                        // matches too, so the two numberings differ.
                        setFindMatches.of({ ranges: docRanges(matches), activeIndex: activeDocIndex(matches, index) }),
                        EditorView.scrollIntoView(m.anchor, { y: "center" }),
                    ],
                });
                if (m.side !== "deleted") {
                    clearRemovedHighlight();
                    return;
                }
                // The widget is only in the DOM once its chunk is near the
                // viewport, so paint after the scroll above has been applied.
                // Best-effort: if it can't be painted the user is still here.
                requestAnimationFrame(() => {
                    const view = viewRef.current;
                    if (!view) return;
                    const { query, caseSensitive } = findQueryRef.current;
                    highlightRemovedMatch(deletedChunkElementAt(view, m.anchor), query, caseSensitive, m.ordinalInRegion);
                });
            },
            clear: () => {
                findMatchesRef.current = [];
                clearRemovedHighlight();
                viewRef.current?.dispatch({ effects: setFindMatches.of({ ranges: [], activeIndex: -1 }) });
            },
            replaceActive: (index, replacement, query, opts) => {
                const v = viewRef.current;
                const m = findMatchesRef.current[index];
                // Removed text is the version being replaced: it is not in the
                // document and its offsets index the original, so splicing at
                // them would corrupt unrelated text.
                if (!v || !m || m.side !== "doc") return;
                const res = replaceOne(v.state.doc.toString(), m.from, query, replacement, opts.caseSensitive, opts.regex);
                if (!res) return;
                applyResultToView(v, { text: res.content, selStart: res.cursor, selEnd: res.cursor });
                // Re-search SYNCHRONOUSLY: the match list is otherwise up to the
                // FindBar's 400ms debounce stale, so a second Replace inside
                // that window spliced at shifted offsets and corrupted
                // neighbouring text (FIND-02). The caret sits just past the
                // replacement, so search() naturally selects the NEXT match.
                doSearch(query, opts);
            },
            replaceAll: (replacement, query, opts) => {
                const v = viewRef.current;
                if (!v) return;
                const starts = replaceableOffsets(findMatchesRef.current);
                const res = replaceAllMatches(v.state.doc.toString(), starts, query, replacement, opts.caseSensitive, opts.regex);
                if (!res) return;
                applyResultToView(v, { text: res.content, selStart: res.cursor, selEnd: res.cursor });
                doSearch(query, opts);
            },
        };
    }, []);

    const handleSlashSelect = useCallback((cmd: SlashCommand) => {
        const v = viewRef.current;
        const cur = slashStateRef.current;
        if (!v || !cur) return;
        const head = v.state.selection.main.head;
        const caretAt = cur.from + (cmd.caretOffset ?? cmd.snippet.length);
        v.dispatch({ changes: { from: cur.from, to: head, insert: cmd.snippet }, selection: { anchor: caretAt } });
        setSlashState(null);
        setSlashQuery("");
        v.focus();
    }, []);

    return (
        <main className="flex-1 flex flex-col overflow-hidden relative">
            {reviewActive && (
                <div className="flex items-center gap-2 px-3 h-9 shrink-0 bg-[var(--bg-secondary)] border-b border-[var(--accent)] text-xs no-select">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse"></span>
                    <span className="text-[var(--text-primary)] font-medium">AI suggested changes</span>
                    <span className="text-[var(--text-muted)] hidden sm:inline">accept or reject each below, or all at once:</span>
                    <div className="ml-auto flex items-center gap-1.5">
                        <button onClick={rejectAllChanges} className="px-2.5 py-1 rounded-[var(--radius-sm)] font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors">Reject all</button>
                        <button onClick={acceptAllChanges} className="px-2.5 py-1 rounded-[var(--radius-sm)] font-medium bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 transition-colors">Accept all</button>
                    </div>
                </div>
            )}
            {showToolbar && (
                <FormatToolbar getState={getState} apply={applyResult} insert={insertAtCaret} onAIAssist={aiEnabled ? openAIBubble : undefined} />
            )}
            <div className="flex-1 overflow-hidden relative">
                <div
                    ref={containerRef}
                    className={`absolute inset-0 [&_.cm-editor]:h-full [&_.cm-editor]:outline-none ${readableLineLength && wordWrap ? "readable-editor" : ""}`}
                />

                <FindBar
                    isOpen={findOpen}
                    initialMode={findMode}
                    controller={editorFindController}
                    openRequest={findRequest}
                    revision={content}
                    onClose={() => { setFindOpen(false); viewRef.current?.focus(); }}
                />

                <SlashMenu
                    isOpen={!!slashState}
                    position={slashState?.pos ?? null}
                    query={slashQuery}
                    onSelect={handleSlashSelect}
                    onClose={() => { setSlashState(null); setSlashQuery(""); }}
                />

                {aiConfig && aiBubble && (
                    <AIBubble
                        anchor={{ x: aiBubble.x, y: aiBubble.y }}
                        selectedText={aiBubble.text}
                        config={aiConfig}
                        onReplace={(out) => {
                            const v = viewRef.current;
                            const range = aiRangeRef.current;
                            // Only replace while the mapped range still holds
                            // exactly the text the model was given; if the user
                            // edited inside it, replacing would destroy that edit.
                            if (v && range && v.state.doc.sliceString(range.from, range.to) === range.text) {
                                v.dispatch({ changes: { from: range.from, to: range.to, insert: out }, selection: { anchor: range.from + out.length } });
                            } else {
                                onNoticeRef.current?.("The selected text changed while AI was working, so nothing was replaced. Use Insert, or run it again.");
                            }
                            aiRangeRef.current = null;
                            setAIBubble(null);
                            v?.focus();
                        }}
                        onInsert={(out) => {
                            const v = viewRef.current;
                            const range = aiRangeRef.current;
                            const ins = "\n\n" + out;
                            if (v && range) {
                                v.dispatch({ changes: { from: range.to, to: range.to, insert: ins }, selection: { anchor: range.to + ins.length } });
                            }
                            aiRangeRef.current = null;
                            setAIBubble(null);
                            v?.focus();
                        }}
                        onClose={() => { aiRangeRef.current = null; setAIBubble(null); }}
                    />
                )}

                {tableUI && (
                    <TableToolbar
                        anchor={{ x: tableUI.x, y: tableUI.y }}
                        activeAlign={tableUI.align}
                        onOp={(op) => {
                            const v = viewRef.current;
                            if (!v) return;
                            const r = applyTableOp(toEdState(v), op);
                            if (r) applyResultToView(v, r);
                            v.focus();
                        }}
                    />
                )}
            </div>
        </main>
    );
}

function spellAttrs(spellCheck: boolean): Record<string, string> {
    return {
        spellcheck: spellCheck ? "true" : "false",
        autocorrect: spellCheck ? "on" : "off",
        autocapitalize: "off",
    };
}

export const CodeEditor = memo(CodeEditorImpl);
