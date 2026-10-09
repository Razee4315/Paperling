/**
 * Clipboard content for a selection in the preview, without the UI chrome
 * that lives inside the rendered document.
 *
 * Icons are Material Symbols ligatures: the heading permalink button holds the
 * literal text "link", the code block's copy button "content_copy". A plain
 * browser copy takes that text along, so copying a heading pasted as
 * "Headlinelink". COPY-01.
 *
 * The selection is cloned, controls are stripped, and the fragment is wrapped
 * in shallow clones of its ancestors up to (not including) `root`, so a
 * selection inside one heading or list still pastes as a heading or list
 * rather than bare text or orphan <li>s.
 */
const CHROME_SELECTOR = "button, .material-symbols-outlined, [data-copy-exclude]";

export function selectionFragment(range: Range, root: Element): HTMLElement {
    const fragment = range.cloneContents();
    fragment.querySelectorAll(CHROME_SELECTOR).forEach((el) => el.remove());

    let content: Node = fragment;
    const start = range.commonAncestorContainer;
    let ancestor: Node | null = start.nodeType === Node.ELEMENT_NODE ? start : start.parentNode;
    while (ancestor && ancestor !== root && root.contains(ancestor)) {
        const shell = ancestor.cloneNode(false);
        shell.appendChild(content);
        content = shell;
        ancestor = ancestor.parentNode;
    }
    const container = document.createElement("div");
    container.appendChild(content);
    return container;
}

/** Plain text for the clipboard: innerText when laid out, textContent otherwise. */
export function fragmentText(container: HTMLElement): string {
    // innerText needs the node in the document to apply block/line breaks.
    container.style.position = "fixed";
    container.style.left = "-99999px";
    document.body.appendChild(container);
    try {
        return container.innerText ?? container.textContent ?? "";
    } finally {
        container.remove();
        container.removeAttribute("style");
    }
}

/**
 * Copy handler body: writes the cleaned selection as HTML and plain text.
 * Returns false (leave the browser's default copy) when the selection is
 * empty or reaches outside `root`.
 */
export function writeCleanSelection(selection: Selection | null, root: Element, data: DataTransfer): boolean {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;
    const container = selectionFragment(range, root);
    const html = container.innerHTML;
    const text = fragmentText(container);
    data.setData("text/html", html);
    data.setData("text/plain", text);
    return true;
}
