import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { parseFrontmatter } from "../utils/frontmatter";
import { matchesBinding, isMac } from "../config/keybindings";
import { applyReaderChange, applyReaderEdit, readerChange, readerEditRange, readerHtmlToMarkdown, readerIslands, READER_ISLAND_ATTR, type ReaderChange, type ReaderEditRange, type ReaderIslandKind } from "../utils/readerEdits";

interface Cursor { start: number; anchor: number; focus: number }
interface HistoryEntry { change: ReaderChange; before: Cursor; after: Cursor; group: string; time: number }
interface History { expected: string; undo: HistoryEntry[]; redo: HistoryEntry[] }
interface Active { element: HTMLElement; original: string; range: ReaderEditRange; html: string; selection: Cursor }
interface Options {
    enabled: boolean;
    docKey: string | null;
    content: string;
    contentRef: RefObject<string>;
    renderedContentRef: RefObject<string>;
    mainRef: RefObject<HTMLElement | null>;
    onChange?: (content: string) => void;
    onRendered?: (content: string) => void;
}

function cleanHtml(element: HTMLElement): string {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button").forEach((button) => button.remove());
    return clone.outerHTML;
}

const ISLAND_SELECTOR = "input[type='checkbox'], .katex, a[data-wikilink], mark, .md-tag";

function islandKind(node: Element): ReaderIslandKind {
    if (node.matches("input")) return "task";
    if (node.matches(".katex")) return "math";
    if (node.matches("a")) return "wikilink";
    return node.matches("mark") ? "highlight" : "tag";
}

/** READ-05: pair each rendered island with the source it came from, in order.
 * The block is editable only when both sides agree on every island's kind;
 * any disagreement (math not rendered yet, syntax the preview read differently)
 * leaves it read-only instead of guessing which bytes belong to which element. */
function stampIslands(element: HTMLElement, source: string): boolean {
    const rendered = Array.from(element.querySelectorAll<HTMLElement>(ISLAND_SELECTOR)).filter((node) => !node.parentElement?.closest(ISLAND_SELECTOR));
    const expected = readerIslands(source);
    if (rendered.length !== expected.length || rendered.some((node, index) => islandKind(node) !== expected[index].kind)) return false;
    rendered.forEach((node, index) => {
        node.setAttribute(READER_ISLAND_ATTR, expected[index].text);
        node.setAttribute("contenteditable", "false");
    });
    return true;
}

function clearIslands(scope: ParentNode | null | undefined) {
    scope?.querySelectorAll(`[${READER_ISLAND_ATTR}]`).forEach((node) => {
        node.removeAttribute(READER_ISLAND_ATTR);
        node.removeAttribute("contenteditable");
    });
}

function textOffset(element: HTMLElement, node: Node, offset: number): number {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return range.toString().length;
}

function textPoint(element: HTMLElement, offset: number): [Node, number] {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null, last: Node | null = null;
    while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (offset <= length) return [node, Math.max(0, offset)];
        offset -= length;
        last = node;
    }
    return last ? [last, last.textContent?.length ?? 0] : [element, 0];
}

function selectText(element: HTMLElement, anchor: number, focus = anchor) {
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    const a = textPoint(element, anchor), f = textPoint(element, focus);
    selection?.setBaseAndExtent(a[0], a[1], f[0], f[1]);
}

/** READ-03: a source-addressed editing session. DOM ranges follow source edits,
 * so switching blocks needs no render/Done cycle. History stores guarded diffs
 * per tab and survives finishing; decorations never enter editable content. */
export function useReaderEditor(options: Options) {
    const latest = useRef(options);
    latest.current = options;
    const active = useRef<Active | null>(null);
    const ranges = useRef(new Map<HTMLElement, ReaderEditRange>());
    const snapshot = useRef<string | null>(null);
    const histories = useRef(new Map<string | null, History>());
    const pending = useRef<Cursor | null>(null);
    const beforeInput = useRef<{ cursor: Cursor; type: string } | null>(null);
    const [revision, setRevision] = useState(0);
    const [, refresh] = useState(0);
    const [notice, setNotice] = useState("");
    const touch = () => refresh((value) => value + 1);
    const source = () => latest.current.contentRef.current;
    const root = () => latest.current.mainRef.current?.querySelector<HTMLElement>(".markdown-body");

    function history(): History {
        const key = latest.current.docKey;
        let h = histories.current.get(key);
        if (!h) {
            h = { expected: source(), undo: [], redo: [] };
            histories.current.set(key, h);
            // Keep bounded histories for recently used tabs, not full notes per key.
            if (histories.current.size > 20) histories.current.delete(histories.current.keys().next().value!);
        }
        return h;
    }

    function cursor(): Cursor {
        const edit = active.current;
        if (!edit) return { start: 0, anchor: 0, focus: 0 };
        const selection = window.getSelection();
        if (selection?.anchorNode && selection.focusNode && edit.element.contains(selection.anchorNode) && edit.element.contains(selection.focusNode)) {
            edit.selection = { start: edit.range.start, anchor: textOffset(edit.element, selection.anchorNode, selection.anchorOffset), focus: textOffset(edit.element, selection.focusNode, selection.focusOffset) };
        }
        return { ...edit.selection, start: edit.range.start };
    }

    function deactivate() {
        const edit = active.current;
        if (edit) {
            edit.element.removeAttribute("contenteditable");
            edit.element.removeAttribute("role");
            edit.element.removeAttribute("aria-label");
            edit.element.removeAttribute("aria-multiline");
            edit.element.classList.remove("reader-editing-block");
        }
        active.current = null;
        beforeInput.current = null;
    }

    function finish() {
        deactivate();
        // These paragraphs/style replacements are owned by the editing session,
        // not React. Remove them before rebuilding from the saved source, or a
        // newly appended paragraph would appear twice after Done (READ-03).
        root()?.querySelectorAll("[data-reader-block]").forEach((element) => element.remove());
        clearIslands(root());
        snapshot.current = null;
        ranges.current.clear();
        const stack = histories.current.get(latest.current.docKey)?.undo;
        const last = stack?.[stack.length - 1];
        if (last) last.time = 0; // Done is a history boundary, not history deletion.
        setRevision((value) => value + 1);
    }

    function initialize(): boolean {
        if (snapshot.current != null) return true;
        if (source() !== latest.current.renderedContentRef.current) return false;
        const parsed = parseFrontmatter(source());
        const fm = parsed.hasFrontmatter ? source().split("\n").length - parsed.body.split("\n").length : 0;
        root()?.querySelectorAll<HTMLElement>("[data-source-line]").forEach((element) => {
            const offset = Number(element.closest("[data-line-offset]")?.getAttribute("data-line-offset") ?? 0) + fm;
            const range = readerEditRange(source(), Number(element.dataset.sourceLine) + offset, Number(element.dataset.sourceEndLine) + offset, element.tagName);
            if (range && stampIslands(element, range.source)) ranges.current.set(element, range);
        });
        snapshot.current = source();
        return true;
    }

    function activate(element: HTMLElement, position?: { anchor: number; focus: number }) {
        if (!latest.current.enabled || !latest.current.onChange) return;
        if (active.current?.element === element) return;
        if (!initialize()) { setNotice("The preview is updating. Try again in a moment."); return; }
        const range = ranges.current.get(element);
        if (!range || source().slice(range.start, range.end) !== range.source) {
            setNotice("This block uses specialized Markdown. Edit it in Code.");
            // A failed activation must not pin a snapshot without an active editor.
            if (!active.current) { snapshot.current = null; ranges.current.clear(); clearIslands(root()); }
            return;
        }
        deactivate();
        // Removing controls is essential: End/Enter used to type into the
        // heading's copy button and serialization then silently removed the text.
        history();
        element.querySelectorAll("button").forEach((button) => button.remove());
        if (/^H[1-6]$/.test(element.tagName)) {
            const title = element.querySelector(":scope > span");
            if (title) title.replaceWith(...Array.from(title.childNodes));
        }
        element.setAttribute("contenteditable", "true");
        element.setAttribute("role", "textbox");
        element.setAttribute("aria-label", "Reader text block");
        element.setAttribute("aria-multiline", "true");
        element.classList.add("reader-editing-block");
        active.current = { element, range, original: range.source, html: cleanHtml(element), selection: { start: range.start, anchor: position?.anchor ?? 0, focus: position?.focus ?? position?.anchor ?? 0 } };
        selectText(element, active.current.selection.anchor, active.current.selection.focus);
        const caretNode = window.getSelection()?.focusNode;
        const caretElement = caretNode instanceof HTMLElement ? caretNode : caretNode?.parentElement;
        caretElement?.scrollIntoView?.({ block: "nearest" });
        setNotice("");
        touch();
    }

    function begin(target: HTMLElement, point?: { x: number; y: number }) {
        if (!latest.current.enabled || target.closest("button,input,textarea,select")) return;
        const element = target.closest<HTMLElement>("[data-source-line],[data-reader-block]");
        if (!element) {
            if (target === root() && !parseFrontmatter(source()).body.trim()) appendParagraph();
            return;
        }
        if (!root()?.contains(element)) return;
        let offset = 0;
        if (point) {
            const range = document.caretRangeFromPoint?.(point.x, point.y);
            if (range && element.contains(range.startContainer) && !(range.startContainer.parentElement?.closest("button"))) offset = textOffset(element, range.startContainer, range.startOffset);
        }
        activate(element, { anchor: offset, focus: offset });
    }

    function record(before: string, after: string, from: Cursor, to: Cursor, group: string) {
        const change = readerChange(before, after);
        if (!change) return;
        const h = history();
        if (h.expected !== before) { h.undo = []; h.redo = []; }
        const previous = h.undo[h.undo.length - 1], now = Date.now();
        if (previous && group && previous.group === group && now - previous.time < 800) {
            const original = applyReaderChange(before, previous.change, true);
            const combined = original == null ? null : readerChange(original, after);
            if (combined) { previous.change = combined; previous.after = to; previous.time = now; }
            else if (original === after) h.undo.pop();
            else h.undo.push({ change, before: from, after: to, group, time: now });
        } else h.undo.push({ change, before: from, after: to, group, time: now });
        h.redo = [];
        while (h.undo.length > 200 || h.undo.reduce((size, entry) => size + entry.change.before.length + entry.change.after.length, 0) > 1_000_000) h.undo.shift();
    }

    function publish(next: string) {
        latest.current.contentRef.current = next;
        history().expected = next;
        latest.current.onChange?.(next);
        latest.current.onRendered?.(next);
        touch();
    }

    function replace(range: ReaderEditRange, replacement: string): { before: string; after: string } | null {
        const before = source(), after = applyReaderEdit(before, range, replacement);
        if (after == null) { finish(); setNotice("The note changed elsewhere. Click the text again to continue safely."); return null; }
        const end = range.end, delta = replacement.length - (end - range.start);
        for (const [element, other] of ranges.current) {
            if (other === range) {
                const updated = { start: range.start, end: range.start + replacement.length, source: replacement };
                ranges.current.set(element, updated);
                if (active.current?.element === element) active.current.range = updated;
            } else if (other.start >= end) { other.start += delta; other.end += delta; }
        }
        return { before, after };
    }

    function write(type?: string) {
        const edit = active.current;
        if (!edit) return;
        const html = cleanHtml(edit.element);
        if (html === edit.html) return;
        const from = beforeInput.current?.cursor ?? edit.selection;
        const kind = type ?? beforeInput.current?.type ?? "input";
        const changed = replace(edit.range, readerHtmlToMarkdown(html, source().includes("\r\n")));
        if (!changed) return;
        edit.html = html;
        const to = cursor();
        const group = /^(insertText|deleteContentBackward|deleteContentForward)$/.test(kind) ? `${edit.range.start}:${kind}` : "";
        record(changed.before, changed.after, from, to, group);
        beforeInput.current = null;
        publish(changed.after);
    }

    function undo(redo = false) {
        const h = history(), stack = redo ? h.redo : h.undo, entry = stack[stack.length - 1];
        if (!entry || h.expected !== source()) return;
        const next = applyReaderChange(source(), entry.change, !redo);
        if (next == null) return;
        (redo ? h.redo : h.undo).pop();
        (redo ? h.undo : h.redo).push(entry);
        pending.current = redo ? entry.after : entry.before;
        finish();
        publish(next);
    }

    function command(name: string, value?: string) {
        const edit = active.current;
        if (!edit) return;
        const position = cursor();
        beforeInput.current = { cursor: position, type: "format" };
        selectText(edit.element, position.anchor, position.focus);
        document.execCommand(name, false, value);
        write("format");
    }

    function appendParagraph() {
        if (!latest.current.enabled || !initialize()) return;
        const before = source(), newline = before.includes("\r\n") ? "\r\n" : "\n";
        const current = active.current, from = cursor();
        const currentRange = current ? { ...current.range } : null;
        const gap = current ? newline + newline : before.length === 0 || before.endsWith(newline + newline) ? "" : before.endsWith(newline) ? newline : newline + newline;
        const insertAt = current?.range.end ?? before.length;
        const changed = replace({ start: insertAt, end: insertAt, source: "" }, gap);
        if (!changed) return;
        if (current && currentRange) {
            // An empty preceding paragraph shares the insertion offset, but
            // belongs BEFORE the new separator rather than after it.
            current.range = currentRange;
            ranges.current.set(current.element, currentRange);
        }
        const after = changed.after, start = insertAt + gap.length;
        const paragraph = document.createElement("p");
        paragraph.setAttribute("data-reader-block", "true"); paragraph.tabIndex = 0;
        if (current) current.element.after(paragraph); else root()?.append(paragraph);
        ranges.current.set(paragraph, { start, end: start, source: "" });
        record(before, after, from, { start, anchor: 0, focus: 0 }, "");
        publish(after); activate(paragraph);
        paragraph.scrollIntoView?.({ block: "nearest" });
    }

    function style(tag: string) {
        const edit = active.current;
        if (!edit || !styleOptions().includes(tag) || tag === edit.element.tagName) return;
        const from = cursor(), element = document.createElement(tag);
        let inline = edit.element.innerHTML;
        const list = /^(UL|OL)$/.test(edit.element.tagName);
        if (list && /^(UL|OL)$/.test(tag)) element.innerHTML = inline;
        else {
            if (list || edit.element.tagName === "BLOCKQUOTE") inline = edit.element.firstElementChild?.innerHTML ?? "";
            if (/^(UL|OL)$/.test(tag)) { const item = document.createElement("li"); item.innerHTML = inline; element.append(item); }
            else if (tag === "BLOCKQUOTE") { const paragraph = document.createElement("p"); paragraph.innerHTML = inline; element.append(paragraph); }
            else element.innerHTML = inline;
        }
        const replacement = readerHtmlToMarkdown(element.outerHTML, source().includes("\r\n"));
        const start = edit.range.start, changed = replace(edit.range, replacement);
        if (!changed) return;
        element.setAttribute("data-reader-block", "true"); element.tabIndex = 0;
        const previous = edit.element;
        deactivate(); ranges.current.delete(previous); previous.replaceWith(element);
        ranges.current.set(element, { start, end: start + replacement.length, source: replacement });
        record(changed.before, changed.after, from, { ...from, start }, "");
        publish(changed.after); activate(element, from);
    }

    function styleOptions(): string[] {
        const element = active.current?.element;
        if (!element) return [];
        const basic = ["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE"];
        if (/^(UL|OL)$/.test(element.tagName)) {
            if (element.children.length !== 1 || element.querySelector("li ul,li ol,li p,li blockquote,li pre")) return ["UL", "OL"];
        }
        if (element.tagName === "BLOCKQUOTE" && (element.children.length !== 1 || !["P", "DIV"].includes(element.firstElementChild?.tagName ?? ""))) return ["BLOCKQUOTE"];
        return basic;
    }

    function inlineCode() {
        const edit = active.current;
        if (!edit) return;
        const position = cursor();
        selectText(edit.element, position.anchor, position.focus);
        const text = window.getSelection()?.toString() ?? "";
        if (!text) { setNotice("Select the text to format as inline code."); return; }
        const code = document.createElement("code"); code.textContent = text;
        command("insertHTML", code.outerHTML); // generated/escaped HTML, never clipboard HTML
    }

    function linkHref(): string {
        cursor();
        const node = window.getSelection()?.focusNode;
        const element = node instanceof Element ? node : node?.parentElement;
        const link = element?.closest("a");
        return link && active.current?.element.contains(link) ? link.getAttribute("href") ?? "" : "";
    }

    function splitParagraph() {
        const edit = active.current, selection = window.getSelection();
        if (!edit || !selection?.rangeCount || !/^(P|H[1-6])$/.test(edit.element.tagName)) return false;
        const selected = selection.getRangeAt(0);
        if (!edit.element.contains(selected.commonAncestorContainer)) return false;
        const from = cursor();
        const left = document.createRange(), right = document.createRange();
        left.selectNodeContents(edit.element); left.setEnd(selected.startContainer, selected.startOffset);
        right.selectNodeContents(edit.element); right.setStart(selected.endContainer, selected.endOffset);
        const leftNode = document.createElement(edit.element.tagName), nextNode = document.createElement("p");
        leftNode.append(left.cloneContents()); nextNode.append(right.cloneContents());
        const crlf = source().includes("\r\n"), newline = crlf ? "\r\n" : "\n";
        // Keep an empty heading's marker; an empty paragraph has a zero-width
        // source range, never an invisible sentinel written into the user's file.
        const prefix = readerHtmlToMarkdown(leftNode.outerHTML, crlf) || (/^H[1-6]$/.test(leftNode.tagName) ? `${"#".repeat(Number(leftNode.tagName[1]))} ` : "");
        const tail = readerHtmlToMarkdown(nextNode.outerHTML, crlf), start = edit.range.start;
        const changed = replace(edit.range, prefix + newline + newline + tail);
        if (!changed) return true;
        edit.element.replaceChildren(...Array.from(leftNode.childNodes));
        ranges.current.set(edit.element, { start, end: start + prefix.length, source: prefix });
        nextNode.setAttribute("data-reader-block", "true"); nextNode.tabIndex = 0;
        edit.element.after(nextNode);
        const nextStart = start + prefix.length + newline.length * 2;
        ranges.current.set(nextNode, { start: nextStart, end: nextStart + tail.length, source: tail });
        deactivate();
        record(changed.before, changed.after, from, { start: nextStart, anchor: 0, focus: 0 }, "");
        publish(changed.after);
        activate(nextNode);
        return true;
    }

    function leaveEmptyItem(): boolean {
        const edit = active.current, node = window.getSelection()?.focusNode;
        if (!edit || !node || !/^(UL|OL|BLOCKQUOTE)$/.test(edit.element.tagName)) return false;
        const parent = node instanceof Element ? node : node.parentElement;
        const item = parent?.closest(edit.element.tagName === "BLOCKQUOTE" ? "p,div" : "li");
        if (!item || item.parentElement !== edit.element || item !== edit.element.lastElementChild || item.textContent?.trim() || item.querySelector("ul,ol,pre,img,table")) return false;
        if (edit.element.children.length === 1) style("P");
        else { item.remove(); write("structure"); appendParagraph(); }
        return true;
    }

    function adjacent(direction: number): HTMLElement | null {
        if (!active.current) return null;
        const elements = [...ranges.current.keys()].filter((element) => element.isConnected).sort((a, b) => ranges.current.get(a)!.start - ranges.current.get(b)!.start);
        return elements[elements.indexOf(active.current.element) + direction] ?? null;
    }

    function join(direction: number): boolean {
        const edit = active.current, neighbor = adjacent(direction);
        if (!edit || !neighbor || !/^(P|H[1-6])$/.test(edit.element.tagName) || !/^(P|H[1-6])$/.test(neighbor.tagName)) return false;
        const first = direction < 0 ? neighbor : edit.element, second = direction < 0 ? edit.element : neighbor;
        const a = ranges.current.get(first)!, b = ranges.current.get(second)!;
        if (!/^\s*$/.test(source().slice(a.end, b.start))) return false; // never erase hidden comments/definitions/media
        const firstText = first.cloneNode(true) as HTMLElement;
        firstText.querySelectorAll("button").forEach((button) => button.remove());
        const from = cursor(), caret = firstText.textContent?.length ?? 0;
        const merged = document.createElement(first.tagName);
        merged.innerHTML = first.innerHTML + second.innerHTML;
        merged.querySelectorAll("button").forEach((button) => button.remove());
        const replacement = readerHtmlToMarkdown(merged.outerHTML, source().includes("\r\n"));
        const combined = { start: a.start, end: b.end, source: source().slice(a.start, b.end) };
        const changed = replace(combined, replacement);
        if (!changed) return true;
        deactivate(); ranges.current.delete(second); second.remove();
        first.replaceChildren(...Array.from(merged.childNodes));
        ranges.current.set(first, { start: a.start, end: a.start + replacement.length, source: replacement });
        record(changed.before, changed.after, from, { start: a.start, anchor: caret, focus: caret }, "");
        publish(changed.after); activate(first, { anchor: caret, focus: caret });
        return true;
    }

    function keyDown(event: ReactKeyboardEvent) {
        if (!latest.current.enabled || event.nativeEvent.isComposing) return;
        if ((event.target as HTMLElement).closest("input,textarea,select")) return;
        const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
        if (mod && !event.altKey && (event.key.toLowerCase() === "z" || (!isMac && event.key.toLowerCase() === "y"))) {
            event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === "y"); return;
        }
        if (matchesBinding(event.nativeEvent, "bold") || matchesBinding(event.nativeEvent, "italic")) {
            if (active.current) { event.preventDefault(); command(matchesBinding(event.nativeEvent, "bold") ? "bold" : "italic"); }
            return;
        }
        if (event.key === "Escape" && active.current) { event.preventDefault(); event.stopPropagation(); finish(); return; }
        if (event.key === "Enter" && !active.current && !(event.target as HTMLElement).closest("button")) { event.preventDefault(); begin(event.target as HTMLElement); return; }
        const edit = active.current;
        if (!edit || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!edit.element.contains(event.target as Node)) return;
        if (event.key === "Enter" && !event.shiftKey && /^(P|H[1-6])$/.test(edit.element.tagName)) { event.preventDefault(); splitParagraph(); return; }
        if (event.key === "Enter" && !event.shiftKey && leaveEmptyItem()) { event.preventDefault(); return; }
        const position = cursor(), length = edit.element.textContent?.length ?? 0;
        if (position.anchor !== position.focus) return;
        const start = position.focus === 0, end = position.focus === length;
        if ((event.key === "Backspace" && start) || (event.key === "Delete" && end)) {
            if (join(event.key === "Backspace" ? -1 : 1)) event.preventDefault();
            return;
        }
        const direction = start && ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : end && ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : 0;
        if (direction) {
            const next = adjacent(direction);
            if (next) { event.preventDefault(); activate(next, { anchor: direction < 0 ? next.textContent?.length ?? 0 : 0, focus: direction < 0 ? next.textContent?.length ?? 0 : 0 }); }
        }
    }

    function rollback() {
        const edit = active.current;
        if (!edit) return;
        const from = cursor(), changed = replace(edit.range, edit.original);
        if (!changed) return;
        record(changed.before, changed.after, from, { start: edit.range.start, anchor: 0, focus: 0 }, "");
        finish(); publish(changed.after);
    }

    // Native beforeinput covers mobile Enter and browser/mobile undo, not just
    // hardware keydown. Composition remains native and is saved on each input.
    useEffect(() => {
        const main = options.mainRef.current;
        const input = (event: InputEvent) => {
            if (!latest.current.enabled || !active.current || !active.current.element.contains(event.target as Node)) return;
            beforeInput.current = { cursor: cursor(), type: event.inputType };
            if (!event.isComposing && event.inputType === "insertParagraph" && /^(P|H[1-6])$/.test(active.current.element.tagName)) { event.preventDefault(); splitParagraph(); }
            else if (!event.isComposing && event.inputType === "insertParagraph" && leaveEmptyItem()) event.preventDefault();
            if (event.inputType === "historyUndo" || event.inputType === "historyRedo") { event.preventDefault(); undo(event.inputType === "historyRedo"); }
        };
        const remember = () => { if (active.current) cursor(); };
        main?.addEventListener("beforeinput", input);
        document.addEventListener("selectionchange", remember);
        return () => { main?.removeEventListener("beforeinput", input); document.removeEventListener("selectionchange", remember); };
        // Handlers read latest refs; avoid rebinding on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options.mainRef]);

    useLayoutEffect(() => {
        const h = histories.current.get(options.docKey);
        const external = h && h.expected !== options.content;
        if (external) { h.undo = []; h.redo = []; h.expected = options.content; touch(); }
        if ((snapshot.current != null && (external || !options.enabled)) || (active.current && !active.current.element.isConnected)) {
            pending.current = null; finish();
            if (external) setNotice("The note changed elsewhere. Click the text to continue.");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options.content, options.docKey, options.enabled]);

    const shownKey = useRef(options.docKey);
    useLayoutEffect(() => {
        if (shownKey.current !== options.docKey) { shownKey.current = options.docKey; pending.current = null; finish(); touch(); }
        if (pending.current && options.renderedContentRef.current === source() && options.enabled) {
            const position = pending.current;
            pending.current = null;
            if (initialize()) {
                let target = [...ranges.current].find(([, range]) => range.start === position.start)?.[0];
                // Undoing the first text in a newly inserted paragraph leaves
                // an empty source gap. Keep a real empty editing surface there.
                if (!target && position.start <= source().length) {
                    const ordered = [...ranges.current].sort((a, b) => a[1].start - b[1].start);
                    const previous = ordered.filter(([, range]) => range.end <= position.start).pop();
                    const next = ordered.find(([, range]) => range.start > position.start);
                    const from = previous?.[1].end ?? (source().length - parseFrontmatter(source()).body.length);
                    const to = next?.[1].start ?? source().length;
                    if (from >= 0 && position.start >= from && /^\s*$/.test(source().slice(from, to))) {
                        target = document.createElement("p"); target.setAttribute("data-reader-block", "true"); target.tabIndex = 0;
                        if (previous) previous[0].after(target); else root()?.prepend(target);
                        ranges.current.set(target, { start: position.start, end: position.start, source: "" });
                    }
                }
                if (target) activate(target, position);
                else { snapshot.current = null; ranges.current.clear(); clearIslands(root()); }
            }
        }
    });

    const h = histories.current.get(options.docKey);
    const sameTab = shownKey.current === options.docKey;
    return {
        active: sameTab ? active.current : null, snapshot: sameTab ? snapshot.current : null, revision, notice,
        canUndo: !!h?.undo.length, canRedo: !!h?.redo.length,
        begin, finish, write, undo, command, keyDown, rollback, appendParagraph, style, styleOptions: styleOptions(), inlineCode, linkHref,
        frozen: sameTab && snapshot.current != null,
    };
}
