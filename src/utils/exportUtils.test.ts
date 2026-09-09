import { describe, it, expect, vi, type Mock } from "vitest";

// exportUtils imports Tauri plugins at module load; stub them so the pure
// HTML-generation helpers can be tested without a Tauri runtime. The functions
// under test (generateHTML, prepareExportHtml) never call these. Exports write
// through the Rust command `write_export_file` via invoke (issue #91, item 1) —
// the fs plugin no longer participates at all.
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { exportToDocx, generateHTML, prepareExportHtml } from "./exportUtils";

const invokeMock = invoke as Mock;

describe("generateHTML", () => {
    it("wraps the content in a standalone HTML document", () => {
        const out = generateHTML("<p>Hello</p>", "My Doc", "dark", "inter", "medium");
        expect(out).toContain("<!DOCTYPE html>");
        expect(out).toContain("<title>My Doc</title>");
        expect(out).toContain("<p>Hello</p>");
        expect(out).toContain("<article>");
    });

    it("escapes HTML-special characters in the title (XSS-safe)", () => {
        const out = generateHTML("<p>x</p>", '<script>alert(1)</script>&"', "dark", "inter", "medium");
        expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;");
        expect(out).not.toContain("<title><script>");
    });

    it("includes the export footer by default and omits it when disabled", () => {
        expect(generateHTML("<p>x</p>", "t", "dark", "inter", "medium")).toContain("Exported from Paperling");
        expect(generateHTML("<p>x</p>", "t", "dark", "inter", "medium", false)).not.toContain("Exported from Paperling");
    });

    it("applies theme-specific colors", () => {
        expect(generateHTML("<p>x</p>", "t", "dark", "inter", "medium")).toContain("#0a0a0a");
        expect(generateHTML("<p>x</p>", "t", "paper", "inter", "medium")).toContain("#f5f0e6");
    });

    it("applies the selected font family and size", () => {
        const out = generateHTML("<p>x</p>", "t", "dark", "inter", "large");
        expect(out).toContain("'Inter'");
        expect(out).toContain("18px"); // large base size
    });

    it("applies a sanitized custom font with Inter as its final fallback", () => {
        const out = generateHTML(
            "<p>x</p>", "t", "dark", "custom", "medium", true,
            'Atkinson Hyperlegible"; color: red'
        );
        expect(out).toContain('font-family: "Atkinson Hyperlegible color red", \'Inter\'');
        expect(out).not.toContain("color: red");
    });

    // ==highlight== and definition lists render in the preview DOM that exports
    // capture, so the export stylesheet must ship matching rules (SYNTAX-01).
    it("ships mark and definition-list styling in the export CSS", () => {
        const out = generateHTML("<p>x</p>", "t", "dark", "inter", "medium");
        expect(out).toMatch(/mark \{[^}]*background: rgba\(255, 196, 0, 0\.35\)/);
        expect(out).toMatch(/dt \{[^}]*font-weight: 600/);
        expect(out).toMatch(/dd \{[^}]*margin: 0 0 0\.25rem 1\.5rem/);
        // Each theme picks its own amber-ish highlight.
        expect(generateHTML("<p>x</p>", "t", "light", "inter", "medium")).toContain("#ffe28a");
        expect(generateHTML("<p>x</p>", "t", "paper", "inter", "medium")).toContain("#efd489");
    });

    // Mermaid SVGs carry an inline natural-size max-width from the preview;
    // export CSS must scale them to the column or they render tiny.
    it("ships column-scaling CSS for rendered mermaid diagrams", () => {
        const out = generateHTML("<p>x</p>", "t", "dark", "inter", "medium");
        expect(out).toContain(".mermaid-rendered > svg");
        expect(out).toContain("max-width: none !important");
        // Diagrams must not be sliced mid-box when printing to PDF.
        expect(out).toMatch(/pre, blockquote, table, img, tr, \.mermaid-rendered \{/);
    });
});

describe("prepareExportHtml", () => {
    it("strips leaked UI chrome (buttons and icon ligatures)", async () => {
        const html = '<p>Body</p><button>Copy</button><span class="material-symbols-outlined">link</span>';
        const out = await prepareExportHtml(html);
        expect(out).toContain("<p>Body</p>");
        expect(out).not.toContain("<button");
        expect(out).not.toContain("material-symbols-outlined");
    });

    it("neutralizes app-internal wikilink anchors into plain text", async () => {
        const out = await prepareExportHtml('<a href="wikilink:Foo">Foo</a>');
        expect(out).toContain("Foo");
        expect(out).not.toContain("wikilink:");
        expect(out).not.toContain("<a");
    });

    it("leaves ordinary links and non-blob images intact", async () => {
        const html = '<a href="https://example.com">site</a><img src="data:image/png;base64,AAAA">';
        const out = await prepareExportHtml(html);
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('src="data:image/png;base64,AAAA"');
    });

    // Relative .md links keep their real href in exports (sibling-file
    // convention); they used to be captured as dead href="#" anchors. EXPORT-04.
    it("preserves relative markdown link hrefs", async () => {
        const out = await prepareExportHtml('<a href="notes/other.md" data-relative-md="true">other</a>');
        expect(out).toContain('href="notes/other.md"');
        expect(out).not.toContain('href="#"');
    });
});

describe("exportToDocx", () => {
    it("returns false and writes nothing when the save dialog is cancelled", async () => {
        (save as Mock).mockResolvedValueOnce(null);
        invokeMock.mockClear();
        const ok = await exportToDocx("<h1>Hi</h1>", "doc.md", "dark", "inter", "medium");
        expect(ok).toBe(false);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it("converts the HTML and writes a valid OOXML .docx to the chosen path", async () => {
        (save as Mock).mockResolvedValueOnce("C:/tmp/out.docx");
        invokeMock.mockClear();
        const ok = await exportToDocx(
            "<h1>Title</h1><p>Hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul>",
            "doc.md",
            "dark", "inter", "medium"
        );
        expect(ok).toBe(true);
        expect(invokeMock).toHaveBeenCalledOnce();
        // Export writes go through the validated Rust command, not the fs plugin.
        expect(invokeMock.mock.calls[0][0]).toBe("write_export_file");
        const { path, data } = invokeMock.mock.calls[0][1];
        expect(path).toBe("C:/tmp/out.docx");
        expect(data).toBeInstanceOf(Array);
        // A .docx is a ZIP archive — it must start with the local-file-header
        // magic bytes "PK\x03\x04". This proves we wrote a real Office document,
        // not an HTML blob with a .docx extension.
        expect(data.slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    }, 20000);

    // NOTE (EXPORT-05): the webview provides no Node globals, and the
    // converter's browser build reaches for global/Buffer/process anyway —
    // exportToDocx shims them via ensureDocxRuntime before loading the chunk.
    // That scenario is untestable under vitest (removing Node's own globals
    // takes the runner down); it was verified against the built bundle in a
    // real browser, where conversion fails without the shims and succeeds
    // with them.
});
