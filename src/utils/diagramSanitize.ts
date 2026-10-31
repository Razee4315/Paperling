import DOMPurify from "dompurify";

/**
 * Second-pass sanitizer for mermaid output (MMV-08).
 *
 * mermaid renders with `securityLevel: "strict"`, which already strips scripts
 * and event handlers from diagram labels — but the display path injects the
 * SVG straight into the DOM (dangerouslySetInnerHTML) and the export paths
 * copy/write it, so a future mermaid strict-mode escape would be immediately
 * exploitable in all of them. This pass re-sanitizes with DOMPurify (already
 * in the bundle for mermaid) as defense in depth.
 *
 * The config mirrors what mermaid itself does to its output (foreignObject is
 * an HTML integration point carrying the XHTML labels, plus its
 * dominant-baseline attribute), so the pass is a no-op on legitimate renders:
 * the scoped `<style>`, `<defs>`/markers/gradients and HTML labels all
 * survive, while script-capable content never does.
 *
 * `allowRemoteImages: false` (the "Load remote images" consent gate, AI-10's
 * document-wide setting) additionally drops `<image>` elements pointing at
 * http(s) resources, so a diagram can't beacon on render when the user turned
 * remote images off. Exports pass no flag: the file only beacons when it is
 * later opened elsewhere, which is the same policy markdown exports follow
 * for external links.
 */
export function sanitizeDiagramSvg(svg: string, opts: { allowRemoteImages?: boolean } = {}): string {
    const allowRemoteImages = opts.allowRemoteImages !== false;
    if (!allowRemoteImages) {
        const dropRemoteImage = (node: Node) => {
            const el = node as Element;
            if (el.tagName?.toLowerCase() !== "image") return;
            const href = el.getAttribute("href") ?? el.getAttribute("xlink:href");
            if (href && !/^(#|data:image\/)/i.test(href)) el.remove();
        };
        DOMPurify.addHook("afterSanitizeAttributes", dropRemoteImage);
        try {
            return sanitize(svg);
        } finally {
            DOMPurify.removeHook("afterSanitizeAttributes", dropRemoteImage);
        }
    }
    return sanitize(svg);
}

function sanitize(svg: string): string {
    return DOMPurify.sanitize(svg, {
        ADD_TAGS: ["foreignobject"],
        ADD_ATTR: ["dominant-baseline"],
        HTML_INTEGRATION_POINTS: { foreignobject: true },
    });
}
