/**
 * Turn an `.html` file into the document the HTML view shows. #295.
 *
 * An HTML file is a whole page, not Markdown: the preview's sanitizer would
 * strip its styles and layout, so it renders in a sandboxed iframe instead
 * (HtmlPreview). The file is untrusted content and the app window holds file
 * access and AI keys, so it never runs there. The layers, outermost first:
 *
 * 1. `sandbox=""` on the iframe: no scripts, forms, popups or same-origin
 *    access. This alone keeps the page away from the app.
 * 2. A CSP in the document's own head, allowing only inline styles and
 *    data:/permitted images. A srcdoc frame also inherits the app's CSP.
 * 3. This builder, which drops what the sandbox would let through: a
 *    `<meta refresh>` navigates a sandboxed frame, and a `<base>` would change
 *    what relative links mean.
 *
 * Parsing goes through DOMParser, so nothing in the file loads or runs while
 * this happens, and the CSP lands in the real <head> however the file is
 * written (a regex can be fooled by `<head>` inside a comment).
 */

import { isUnsafeRelativePath } from "./documentPaths";

/** Limits on what one page pulls in from its folder, so a page pointing at
 *  thousands of assets can't stall the app or balloon the srcdoc string. */
const MAX_LOCAL_IMAGES = 200;
const MAX_LOCAL_STYLESHEETS = 20;
const MAX_LOCAL_ASSET_BYTES = 32 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    avif: "image/avif",
    svg: "image/svg+xml",
};

export interface HtmlAssetReader {
    /** Bytes of an image, through the validated read_image_file command. */
    readImage: (baseDir: string, relPath: string) => Promise<ArrayBuffer>;
    /** Text of a stylesheet next to the document. */
    readText: (baseDir: string, relPath: string) => Promise<string>;
}

export interface HtmlDocumentOptions {
    /** Folder of the file on disk; null for an untitled buffer. */
    baseDir: string | null;
    /** Settings → Remote images. Off keeps https images out, as in Markdown. */
    allowRemoteImages: boolean;
    assets?: HtmlAssetReader;
}

/** The policy written into the page's head. */
export function htmlViewCsp(allowRemoteImages: boolean): string {
    const images = allowRemoteImages ? "data: https:" : "data:";
    return `default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src data:; media-src data:`;
}

/** A relative reference that may be read from the document's folder, cleaned
 *  of `./`, query and fragment; null for URLs and anything escaping the folder. */
export function localAssetPath(ref: string | null): string | null {
    const value = ref?.trim();
    if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("#")) return null;
    const path = value.replace(/[?#].*$/, "").replace(/^(\.\/)+/, "");
    let decoded = path;
    try { decoded = decodeURIComponent(path); } catch { /* keep the raw path */ }
    return isUnsafeRelativePath(decoded) ? null : decoded;
}

function bytesToDataUrl(bytes: ArrayBuffer, mime: string): string {
    const view = new Uint8Array(bytes);
    let binary = "";
    // Chunked: String.fromCharCode(...hugeArray) overflows the call stack.
    for (let i = 0; i < view.length; i += 0x8000) {
        binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

async function inlineLocalAssets(doc: Document, baseDir: string, assets: HtmlAssetReader) {
    let budget = MAX_LOCAL_ASSET_BYTES;

    const sheets = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')].slice(0, MAX_LOCAL_STYLESHEETS);
    await Promise.all(sheets.map(async (link) => {
        const rel = localAssetPath(link.getAttribute("href"));
        if (!rel) return;
        try {
            const css = await assets.readText(baseDir, rel);
            if (css.length > budget) return;
            budget -= css.length;
            const style = doc.createElement("style");
            style.textContent = css;
            link.replaceWith(style);
        } catch { /* a missing stylesheet leaves the page unstyled, as in a browser */ }
    }));

    const images = [...doc.querySelectorAll<HTMLImageElement>("img[src]")].slice(0, MAX_LOCAL_IMAGES);
    await Promise.all(images.map(async (img) => {
        const rel = localAssetPath(img.getAttribute("src"));
        if (!rel) return;
        const mime = IMAGE_MIME[rel.split(".").pop()?.toLowerCase() ?? ""];
        if (!mime) return;
        try {
            const bytes = await assets.readImage(baseDir, rel);
            if (bytes.byteLength > budget) return;
            budget -= bytes.byteLength;
            img.setAttribute("src", bytesToDataUrl(bytes, mime));
        } catch { /* the broken-image icon is the honest result */ }
    }));
}

function doctypeOf(doc: Document): string {
    const dt = doc.doctype;
    if (!dt) return "";
    const ids = dt.publicId
        ? ` PUBLIC "${dt.publicId}"${dt.systemId ? ` "${dt.systemId}"` : ""}`
        : dt.systemId ? ` SYSTEM "${dt.systemId}"` : "";
    return `<!DOCTYPE ${dt.name}${ids}>\n`;
}

/** The `srcdoc` for `html`. Keeps a page's doctype, so it stays in the same
 *  rendering mode a browser would use. */
export async function buildHtmlDocument(html: string, options: HtmlDocumentOptions): Promise<string> {
    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("script, base, meta[http-equiv]").forEach((el) => el.remove());

    if (options.baseDir && options.assets) {
        await inlineLocalAssets(doc, options.baseDir, options.assets);
    }

    // Without a popup grant, a `_blank` link does nothing: following a link
    // would otherwise replace the page with an error, since the frame can't
    // leave the app. In-page anchors stay live.
    doc.querySelectorAll<HTMLAnchorElement>("a[href], area[href]").forEach((a) => {
        a.setAttribute("target", a.getAttribute("href")?.startsWith("#") ? "_self" : "_blank");
    });

    const csp = doc.createElement("meta");
    csp.setAttribute("http-equiv", "Content-Security-Policy");
    csp.setAttribute("content", htmlViewCsp(options.allowRemoteImages));
    doc.head.prepend(csp);

    return doctypeOf(doc) + doc.documentElement.outerHTML;
}
