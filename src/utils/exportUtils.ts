import { Theme, FontFamily, FontSize } from '../context/ThemeContext';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getFontName, getFontStack } from './fontFamily';

// All export writes go through the validated Rust command `write_export_file`
// (dialog-chosen path, atomic write) instead of the fs plugin, so the webview
// carries no filesystem permission at all. Issue #91, item 1.
async function writeExportFile(path: string, data: Uint8Array): Promise<void> {
    await invoke('write_export_file', { path, data: Array.from(data) });
}

// Theme color definitions for export
const themeColors: Record<Theme, Record<string, string>> = {
    dark: {
        bgPrimary: '#0a0a0a',
        bgSecondary: '#141414',
        textPrimary: '#ffffff',
        textSecondary: '#737373',
        border: '#262626',
        codeBg: '#141414',
        codeText: '#a3a3a3',
        blockquoteBg: 'rgba(20, 20, 20, 0.8)',
        accent: '#ffffff',
        syntaxH1: '#ffffff',
        syntaxH2: '#e5e5e5',
        syntaxH3: '#d4d4d4',
        syntaxLink: '#a3a3a3',
        syntaxBold: '#ffffff',
        markBg: 'rgba(255, 196, 0, 0.35)',
    },
    light: {
        bgPrimary: '#ffffff',
        bgSecondary: '#fafafa',
        textPrimary: '#171717',
        textSecondary: '#525252',
        border: '#e5e5e5',
        codeBg: '#f5f5f5',
        codeText: '#dc2626',
        blockquoteBg: 'rgba(250, 250, 250, 0.8)',
        accent: '#171717',
        syntaxH1: '#171717',
        syntaxH2: '#262626',
        syntaxH3: '#404040',
        syntaxLink: '#2563eb',
        syntaxBold: '#171717',
        markBg: '#ffe28a',
    },
    paper: {
        bgPrimary: '#f5f0e6',
        bgSecondary: '#ebe5d8',
        textPrimary: '#3d3d3d',
        textSecondary: '#6b6352',
        border: '#d4cfc2',
        codeBg: '#ebe5d8',
        codeText: '#8b5a2b',
        blockquoteBg: 'rgba(235, 229, 216, 0.6)',
        accent: '#5c4033',
        syntaxH1: '#3d3029',
        syntaxH2: '#5c4033',
        syntaxH3: '#6b5344',
        syntaxLink: '#2d5a7b',
        syntaxBold: '#5c4033',
        markBg: '#efd489',
    },
    dracula: {
        bgPrimary: '#282a36',
        bgSecondary: '#343746',
        textPrimary: '#f8f8f2',
        textSecondary: '#d6d6d6',
        border: '#44475a',
        codeBg: '#21222c',
        codeText: '#f8f8f2',
        blockquoteBg: 'rgba(68, 71, 90, 0.35)',
        accent: '#bd93f9',
        syntaxH1: '#ff79c6',
        syntaxH2: '#ff79c6',
        syntaxH3: '#bd93f9',
        syntaxLink: '#8be9fd',
        syntaxBold: '#f8f8f2',
        markBg: 'rgba(255, 184, 108, 0.35)',
    },
};

// Font size definitions
const fontSizes: Record<FontSize, { base: string; h1: string; h2: string; h3: string; lineHeight: string }> = {
    small: { base: '14px', h1: '1.875em', h2: '1.5em', h3: '1.125em', lineHeight: '1.6' },
    medium: { base: '16px', h1: '2.25em', h2: '1.75em', h3: '1.25em', lineHeight: '1.7' },
    large: { base: '18px', h1: '2.5em', h2: '2em', h3: '1.375em', lineHeight: '1.8' },
};

// Generate CSS for export
function generateExportCSS(theme: Theme, font: FontFamily, fontSize: FontSize, customFont = ''): string {
    const colors = themeColors[theme];
    const fontFamily = getFontStack(font, customFont);
    const sizes = fontSizes[fontSize];

    // No Google Fonts @import here — exporting must succeed offline, and the
    // resulting HTML must render reasonably on machines that can't reach the
    // CDN. The font-family declarations below use the same display names as
    // the editor (Inter, Merriweather, Lora, Source Serif 4, Fira Sans,
    // JetBrains Mono); the recipient sees those if installed locally,
    // otherwise the cascade falls back to a safe system font in the same
    // genre (sans-serif, serif, or monospace).
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: ${fontFamily};
            font-size: ${sizes.base};
            line-height: ${sizes.lineHeight};
            background-color: ${colors.bgPrimary};
            color: ${colors.textPrimary};
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            padding: 3rem;
            max-width: 800px;
            margin: 0 auto;
        }

        @page {
            margin: 18mm 16mm;
        }

        @media print {
            html, body {
                background: #ffffff;
            }
            body {
                padding: 0;
                max-width: none;
                color: #171717;
            }
            /* Browsers drop background fills when printing unless asked; keep
               code blocks, table headers and blockquote tints visible. */
            pre, code, th, blockquote, .hljs, mark {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            /* Keep atomic blocks and their headings from splitting awkwardly. */
            pre, blockquote, table, img, tr, .mermaid-rendered {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            h1, h2, h3, h4, h5, h6 {
                page-break-after: avoid;
                break-after: avoid;
            }
        }

        h1 {
            font-size: ${sizes.h1};
            font-weight: 800;
            padding-bottom: 0.3em;
            border-bottom: 1px solid ${colors.border};
            color: ${colors.syntaxH1};
            margin-bottom: 1rem;
            margin-top: 0;
        }

        h2 {
            font-size: ${sizes.h2};
            font-weight: 700;
            padding-bottom: 0.3em;
            border-bottom: 1px solid ${colors.border};
            color: ${colors.syntaxH2};
            margin-top: 2rem;
            margin-bottom: 1rem;
        }

        h3 {
            font-size: ${sizes.h3};
            font-weight: 600;
            color: ${colors.syntaxH3};
            margin-top: 1.5rem;
            margin-bottom: 0.5rem;
        }

        h4, h5, h6 {
            font-weight: 600;
            color: ${colors.syntaxH3};
            margin-top: 1.25rem;
            margin-bottom: 0.5rem;
        }

        p {
            margin-bottom: 1rem;
        }

        a {
            color: ${colors.syntaxLink};
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        strong {
            font-weight: 600;
            color: ${colors.syntaxBold};
        }

        /* ==highlight== (remark-flexible-markers) — mirrors the preview's
           .markdown-body mark rule; amber-ish per theme, text stays the
           theme's primary color for legibility. */
        mark {
            background: ${colors.markBg};
            color: ${colors.textPrimary};
            padding: 0.05em 0.15em;
            border-radius: 0.2em;
        }

        /* Definition lists (remark-definition-list) — mirrors the preview. */
        dl {
            margin: 0 0 1rem;
        }

        dt {
            font-weight: 600;
            color: ${colors.syntaxBold};
            margin-top: 0.5rem;
        }

        dd {
            margin: 0 0 0.25rem 1.5rem;
        }

        em {
            font-style: italic;
        }

        code {
            font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
            background: ${colors.codeBg};
            border: 1px solid ${colors.border};
            border-radius: 0.25rem;
            padding: 0.1em 0.3em;
            font-size: 0.875em;
            color: ${colors.codeText};
        }

        pre {
            background: ${colors.codeBg};
            border: 1px solid ${colors.border};
            border-radius: 0.375rem;
            padding: 1rem;
            overflow-x: auto;
            margin: 1rem 0;
        }

        pre code {
            background: none;
            border: none;
            padding: 0;
            color: ${colors.textPrimary};
            font-size: 0.9em;
        }

        ul, ol {
            padding-left: 1.5rem;
            margin-bottom: 1rem;
        }

        li {
            margin-bottom: 0.25rem;
        }

        li > ul, li > ol {
            margin-top: 0.25rem;
            margin-bottom: 0;
        }

        blockquote {
            border-left: 4px solid ${colors.accent};
            background: ${colors.blockquoteBg};
            padding: 0.5rem 1rem;
            margin: 1rem 0;
            font-style: italic;
            color: ${colors.textSecondary};
            border-radius: 0 0.25rem 0.25rem 0;
        }

        blockquote p:last-child {
            margin-bottom: 0;
        }

        hr {
            border: none;
            border-top: 1px solid ${colors.border};
            margin: 2rem 0;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
        }

        th, td {
            border: 1px solid ${colors.border};
            padding: 0.5rem 0.75rem;
            text-align: left;
        }

        th {
            background: ${colors.bgSecondary};
            font-weight: 600;
        }

        img {
            max-width: 100%;
            height: auto;
            border-radius: 0.375rem;
            margin: 1rem 0;
        }

        /* Exports capture the preview DOM, so rendered mermaid SVGs arrive
           with mermaid's inline natural-size max-width; mirror the preview's
           column scaling (see index.css .mermaid-rendered). The container's
           Tailwind classes don't exist in exports, hence the margin here. */
        .mermaid-rendered {
            margin: 1rem 0;
        }
        .mermaid-rendered > svg {
            width: 100%;
            height: auto;
            max-width: none !important;
        }

        /* Task lists */
        input[type="checkbox"] {
            margin-right: 0.5rem;
            transform: scale(1.1);
        }

        /* Syntax highlighting */
        .hljs-keyword { color: ${colors.syntaxH2}; }
        .hljs-string { color: ${colors.syntaxBold}; }
        .hljs-number { color: ${colors.syntaxH1}; }
        .hljs-function { color: #22c55e; }
        .hljs-comment { color: ${colors.textSecondary}; font-style: italic; }
        .hljs-title { color: #22c55e; }
        .hljs-params { color: ${colors.textSecondary}; }
        .hljs-built_in { color: ${colors.syntaxLink}; }
        .hljs-attr { color: #22c55e; }
        .hljs-literal { color: ${colors.syntaxH1}; }

        /* Footer */
        .export-footer {
            margin-top: 3rem;
            padding-top: 1rem;
            border-top: 1px solid ${colors.border};
            text-align: center;
            font-size: 0.75rem;
            color: ${colors.textSecondary};
        }
    `;
}

/**
 * Clean the live preview's innerHTML for export (EXPORT-01):
 *  - strips UI chrome that leaked in from interactive renderers: code-block
 *    "Copy" buttons and heading anchor buttons (whose Material Symbols
 *    ligatures render as literal words like "link" without the icon font);
 *  - inlines blob: image URLs as data: URIs — blob URLs are session-bound, so
 *    exported files referencing them show broken images;
 *  - neutralizes wikilink: hrefs (app-internal scheme) into plain text.
 */
export async function prepareExportHtml(rawHtml: string): Promise<string> {
    const doc = new DOMParser().parseFromString(`<div id="__export_root">${rawHtml}</div>`, "text/html");
    const root = doc.getElementById("__export_root");
    if (!root) return rawHtml;

    root.querySelectorAll("button").forEach((b) => b.remove());
    root.querySelectorAll(".material-symbols-outlined").forEach((s) => s.remove());

    root.querySelectorAll("a[href^='wikilink:']").forEach((a) => {
        const span = doc.createElement("span");
        span.textContent = a.textContent;
        a.replaceWith(span);
    });

    for (const img of Array.from(root.querySelectorAll("img"))) {
        const src = img.getAttribute("src") || "";
        if (!src.startsWith("blob:")) continue;
        try {
            const blob = await (await fetch(src)).blob();
            const dataUri = await new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result as string);
                fr.onerror = () => reject(fr.error);
                fr.readAsDataURL(blob);
            });
            img.setAttribute("src", dataUri);
        } catch {
            // Blob already revoked or unreadable — leave the src; the alt text
            // still communicates what belonged there.
        }
    }

    return root.innerHTML;
}

// Escape HTML entities to prevent XSS in generated HTML
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Generate standalone HTML document
export function generateHTML(
    htmlContent: string,
    title: string,
    theme: Theme,
    font: FontFamily,
    fontSize: FontSize,
    includeFooter: boolean = true,
    customFont: string = ''
): string {
    const css = generateExportCSS(theme, font, fontSize, customFont);
    const safeTitle = escapeHtml(title);
    const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const footer = includeFooter
        ? `<footer class="export-footer">Exported from Paperling on ${date}</footer>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="generator" content="Paperling">
    <meta name="date" content="${new Date().toISOString()}">
    <title>${safeTitle}</title>
    <style>${css}</style>
</head>
<body>
    <article>
        ${htmlContent}
    </article>
    ${footer}
</body>
</html>`;
}

// Export to HTML file. Resolves `true` when a file was actually written, and
// `false` when the user cancelled the save dialog — so the caller can skip the
// "Exported" confirmation toast on cancel.
export async function exportToHTML(
    htmlContent: string,
    fileName: string,
    theme: Theme,
    font: FontFamily,
    fontSize: FontSize,
    customFont: string = ''
): Promise<boolean> {
    const title = fileName.replace(/\.(md|markdown)$/i, '');
    const cleaned = await prepareExportHtml(htmlContent);
    const fullHTML = generateHTML(cleaned, title, theme, font, fontSize, true, customFont);

    // Use Tauri save dialog
    const filePath = await save({
        defaultPath: `${title}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
    });

    if (!filePath) return false;
    await writeExportFile(filePath, new TextEncoder().encode(fullHTML));
    return true;
}

// ---------------------------------------------------------------------------
// DOCX export
//
// Converts the same cleaned preview HTML we use for HTML/PDF into a real Office
// Open XML (.docx) document via @turbodocx/html-to-docx — pure JS, no headless
// browser or native binary, and Vite resolves its dedicated browser ESM build.
// The library is dynamically imported so its weight stays out of the main chunk
// (and off the cold-start path) until the user actually exports to Word.
//
// Like PDF, DOCX is always a light, print-style document — a shared Word file
// must be legible on white. Headings, lists, tables, bold/italic, links, and
// images (inlined as data URIs by prepareExportHtml) carry over faithfully. Math
// (KaTeX) and Mermaid diagrams are HTML/SVG constructs Word has no native model
// for, so they degrade to their textual/markup form — the same caveat every
// Markdown-to-Word path has. EXPORT-02.
type HtmlToDocx = (
    html: string,
    header?: string | null,
    options?: Record<string, unknown>,
    footer?: string | null
) => Promise<ArrayBuffer | Blob | Uint8Array>;

// @turbodocx/html-to-docx's browser build still reaches for Node's `global`,
// `Buffer` and `process`; the webview provides none of them, so conversion
// threw "global is not defined" the moment the chunk ran. Tests never caught
// it because vitest runs in Node, which supplies all three. Shim them right
// before the library loads — the Buffer polyfill is itself dynamically
// imported, so none of this weighs on cold start. EXPORT-05.
async function ensureDocxRuntime(): Promise<void> {
    const g = globalThis as Record<string, unknown>;
    if (typeof g.global === "undefined") g.global = g;
    if (typeof g.process === "undefined") g.process = { env: {} };
    if (typeof g.Buffer === "undefined") {
        // In the browser bundle "buffer" resolves to the npm polyfill package;
        // under Node (vitest) it resolves to the builtin. Both export Buffer.
        const { Buffer } = await import("buffer");
        g.Buffer = Buffer;
    }
}

export async function exportToDocx(
    htmlContent: string,
    fileName: string,
    _theme: Theme,
    font: FontFamily,
    _fontSize: FontSize,
    customFont: string = ''
): Promise<boolean> {
    if (!htmlContent || htmlContent.trim() === '') {
        console.error('No HTML content to export!');
        return false;
    }

    const title = fileName.replace(/\.(md|markdown)$/i, '');
    const cleaned = await prepareExportHtml(htmlContent);
    // A minimal, unthemed document — the converter maps semantic HTML to Word
    // styles, so we deliberately don't inject the screen theme's colors here.
    const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><article>${cleaned}</article></body></html>`;

    // Prompt for the destination first so we don't do the (heavier) conversion
    // work when the user is just going to cancel.
    const filePath = await save({
        defaultPath: `${title}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (!filePath) return false;

    await ensureDocxRuntime();
    const mod = await import('@turbodocx/html-to-docx');
    // The package uses `export =`; the function is the default export under the
    // browser/ESM build. Fall back to the namespace itself for the CJS shape.
    const convert = ((mod as { default?: HtmlToDocx }).default ?? (mod as unknown as HtmlToDocx)) as HtmlToDocx;

    const out = await convert(docHtml, null, {
        title,
        creator: 'Paperling',
        footer: false,
        pageNumber: false,
        font: getFontName(font, customFont),
        // Word measures run size in half-points; 22 == 11pt body text.
        fontSize: 22,
        table: { row: { cantSplit: true } },
    });

    const bytes =
        out instanceof Blob ? new Uint8Array(await out.arrayBuffer())
        : out instanceof Uint8Array ? out
        : new Uint8Array(out as ArrayBuffer);
    await writeExportFile(filePath, bytes);
    return true;
}

// ---------------------------------------------------------------------------
// PDF export
//
// We deliberately do NOT rasterize or hand-roll a PDF layout. Instead we hand
// the same standalone HTML we produce for HTML export to a real print engine.
// That yields a vector PDF that matches the preview exactly: real Unicode and
// color emoji, selectable/searchable text and working links — none of which the
// old jsPDF standard-font path could do (it encoded text as single-byte
// WinAnsi, so anything outside Latin-1 — emoji, smart quotes, em dashes —
// printed as garbage).
//
// Windows and macOS go through the Rust `export_pdf` command, which writes the
// PDF silently (WebView2 PrintToPdf / NSPrintOperation). Linux renders in an
// isolated off-screen iframe and drives the webview's own print pipeline.
// ---------------------------------------------------------------------------

const PRINT_FRAME_ID = '__paperling_print_frame';

// Resolve once every <img> has finished loading (or failed) so the print job
// never captures half-decoded images. Sources are inlined as data: URIs by
// prepareExportHtml, so this usually settles almost immediately.
function waitForImages(doc: Document): Promise<void> {
    const imgs = Array.from(doc.images ?? []);
    return Promise.all(
        imgs.map((img) =>
            img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                      img.addEventListener('load', () => resolve(), { once: true });
                      img.addEventListener('error', () => resolve(), { once: true });
                  })
        )
    ).then(() => undefined);
}

// Render `html` in a hidden iframe and invoke the webview's native print
// dialog. Resolves as soon as the dialog has been handed off, NOT when it
// closes: WebKitGTK does not fire `afterprint` for a cancelled dialog, and
// waiting on it left the export button spinning for the full fallback window
// when the user cancelled (#111). The caller already treats the hand-off as
// terminal (EXPORT-01: the system dialog is its own feedback), so frame
// cleanup happens in the background on afterprint or a long reap timer.
function printHtmlDocument(html: string): Promise<void> {
    return new Promise((resolve) => {
        // Remove any frame left over from a previous (e.g. cancelled) export.
        document.getElementById(PRINT_FRAME_ID)?.remove();

        const iframe = document.createElement('iframe');
        iframe.id = PRINT_FRAME_ID;
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('tabindex', '-1');
        Object.assign(iframe.style, {
            position: 'fixed',
            left: '-9999px',
            top: '0',
            // A4-ish width at 96dpi so on-screen layout is sane before the print
            // engine re-flows to the real page size.
            width: '794px',
            height: '0',
            border: '0',
            opacity: '0',
            pointerEvents: 'none',
        });

        let settled = false;
        const finish = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };

        // A srcdoc iframe fires `load` twice in WebKit engines: once for the
        // initial about:blank document and once for the srcdoc content. The
        // handler used to call print() on both, stacking two print dialogs
        // (#111). Trigger exactly once, and only on a load whose document
        // actually has content (about:blank has an empty body).
        let printed = false;

        // If a content-bearing load never arrives, give up instead of hanging
        // the caller behind a spinner.
        const safetyTimer = setTimeout(() => {
            if (!printed) {
                iframe.remove();
                finish();
            }
        }, 15000);

        iframe.onload = () => {
            const win = iframe.contentWindow;
            if (!win) {
                clearTimeout(safetyTimer);
                iframe.remove();
                finish();
                return;
            }
            if (printed || !win.document.body || win.document.body.childNodes.length === 0) return;
            printed = true;
            clearTimeout(safetyTimer);

            // The frame must outlive the dialog: the print engine reads the
            // document lazily. Reap it on afterprint when the engine emits
            // one, or by timer when it doesn't.
            const reapTimer = setTimeout(() => iframe.remove(), 120000);
            const reap = () => {
                win.removeEventListener('afterprint', reap);
                clearTimeout(reapTimer);
                // Defer removal a tick: some engines read the document
                // asynchronously after the dialog closes.
                setTimeout(() => iframe.remove(), 300);
            };
            win.addEventListener('afterprint', reap);

            Promise.all([
                win.document.fonts?.ready?.catch(() => undefined),
                waitForImages(win.document),
            ]).then(() => {
                try {
                    win.focus();
                    win.print();
                } catch {
                    reap();
                } finally {
                    // Hand-off complete. Unblock the caller regardless of how,
                    // or whether, the dialog closes.
                    finish();
                }
            });
        };

        document.body.appendChild(iframe);
        iframe.srcdoc = html;
    });
}

// Export to PDF. The theme argument is intentionally ignored: a shared/printed
// PDF must be legible on white paper, so we always render the light theme. The
// on-screen HTML export still honours the chosen theme.
//
// On Windows and macOS we ask once where to save (like HTML export) and hand
// the HTML to the Rust `export_pdf` command, which renders it in a hidden
// webview and writes a real PDF via the native print engine — no print dialog.
// The iframe fallback is NOT an option on macOS: WKWebView has no JS
// `window.print()` at all (wry only shims it for WebView2), so it silently did
// nothing there (#96). Linux keeps the print-pipeline fallback, which WebKitGTK
// does implement.
// Resolves:
//   'saved'    — Windows/macOS: the PDF was written to the chosen path.
//   'cancelled'— Windows/macOS: the user dismissed the save dialog.
//   'printing' — Linux: the native print dialog was handed off. We can't tell
//                save from cancel there, so the caller must NOT claim
//                "Exported" — the system dialog is its own feedback. EXPORT-01.
export type PdfExportResult = 'saved' | 'cancelled' | 'printing';

export async function exportToPDF(
    htmlContent: string,
    fileName: string,
    _theme: Theme,
    font: FontFamily,
    fontSize: FontSize,
    customFont: string = ''
): Promise<PdfExportResult> {
    if (!htmlContent || htmlContent.trim() === '') {
        console.error('No HTML content to export!');
        return 'cancelled';
    }

    const title = fileName.replace(/\.(md|markdown)$/i, '');

    // Same cleanup as HTML export — strips UI chrome (copy buttons, heading
    // anchor icons) and inlines blob: images as data: URIs.
    const cleaned = await prepareExportHtml(htmlContent);
    const fullHTML = generateHTML(cleaned, title, 'light', font, fontSize, true, customFont);

    const canSaveSilently =
        typeof navigator !== 'undefined' &&
        /Windows|Macintosh/i.test(navigator.userAgent);

    if (canSaveSilently) {
        const filePath = await save({
            defaultPath: `${title}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        // Dialog cancelled — nothing to do.
        if (!filePath) return 'cancelled';
        await invoke('export_pdf', { html: fullHTML, path: filePath });
        return 'saved';
    }

    await printHtmlDocument(fullHTML);
    return 'printing';
}
