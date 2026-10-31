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
// A 1x1 transparent GIF. The reference has to stay loadable: mermaid's image
// shape awaits decode(), so a removed or broken one fails the whole diagram.
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const QUOTE = `["']|#quot;|#34;|&quot;|&#34;`;
const REMOTE_IMAGE_REF = new RegExp(
    `(\\bimg\\s*:\\s*|\\bsrc\\s*=\\s*|url\\(\\s*)(${QUOTE})?(?:https?:)?//(?:(?!${QUOTE})[^\\s<>)])+`,
    "gi",
);

/**
 * Blanks remote image references in diagram SOURCE. sanitizeDiagramSvg can't
 * stop these on its own: mermaid loads an image shape's picture while it draws,
 * and an HTML label's <img> as soon as it reaches the render container, so the
 * request has left before there is any output to clean. With remote images off
 * the source must not carry the URL at all. MMV-09.
 */
export function stripRemoteDiagramImages(code: string): string {
    return code.replace(REMOTE_IMAGE_REF, (_match, prefix: string, quote = "") => `${prefix}${quote}${BLANK_IMAGE}`);
}

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
