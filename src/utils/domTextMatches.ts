// Plain-text matching over rendered DOM, shared by the two find surfaces that
// search painted output rather than source text: reader mode (previewFind) and
// the removed lines of an AI review (reviewFindHighlight).
//
// Extracted from previewFind so both use one implementation, and so the
// text-node walking is testable on its own.
//
// Known limit, inherited and deliberate: a match that spans element boundaries
// (`bold**text**`, or a review line split at a change boundary) is not found,
// because each text node is scanned independently. That is the same trade-off
// VS Code's webview find makes.

export const MAX_DOM_MATCHES = 5000;

/**
 * Ranges for every occurrence of `query` in `root`'s text nodes, in document
 * order. Nodes under any selector in `skip` are ignored, which keeps chrome
 * (e.g. a review chunk's Accept/Reject buttons) out of the results.
 */
export function collectDomMatches(
    root: HTMLElement,
    query: string,
    caseSensitive: boolean,
    skip: readonly string[] = []
): Range[] {
    const ranges: Range[] = [];
    if (!query) return ranges;
    const q = caseSensitive ? query : query.toLowerCase();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
            skip.length && node.parentElement?.closest(skip.join(","))
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT,
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
        const data = (node as Text).data;
        const text = caseSensitive ? data : data.toLowerCase();
        let i = text.indexOf(q);
        while (i !== -1) {
            const r = new Range();
            r.setStart(node, i);
            r.setEnd(node, i + q.length);
            ranges.push(r);
            if (ranges.length >= MAX_DOM_MATCHES) return ranges;
            i = text.indexOf(q, i + q.length);
        }
    }
    return ranges;
}
