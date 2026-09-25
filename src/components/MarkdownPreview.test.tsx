// Regression test for footnote navigation (CodenameFlux report): remark-rehype
// already prefixes footnote ids and hrefs with `user-content-`, and
// rehype-sanitize's default clobber pass used to prefix the id a SECOND time,
// so footnote refs and back-arrows pointed at ids that don't exist. The
// invariant asserted here — every in-page link's href resolves to a real id in
// the rendered document — is what keeps clicks working in the app and links
// working in exported HTML, regardless of prefix policy.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(async () => null),
    convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

afterEach(cleanup);

function renderPreview(content: string, extraProps: Record<string, unknown> = {}) {
    return render(
        <MarkdownPreview
            content={content}
            fileName="test.md"
            fileSize={content.length}
            onEditClick={() => {}}
            {...extraProps}
        />,
    );
}

describe("footnote links", () => {
    it("gives every footnote ref and back-arrow an href that resolves to a real id", async () => {
        const { container } = renderPreview(
            "Some text[^1] and more[^2].\n\n[^1]: First note.\n[^2]: Second note.",
        );
        // The body renders through useTransition, so wait for the links.
        const links = await waitFor(() => {
            const ls = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href^='#']"));
            expect(ls.length).toBeGreaterThanOrEqual(4); // 2 refs + 2 back-arrows
            return ls;
        });
        for (const link of links) {
            const id = decodeURIComponent(link.getAttribute("href")!.slice(1));
            expect(
                container.querySelector(`[id="${id}"]`),
                `no element with id "${id}" for href "${link.getAttribute("href")}"`,
            ).toBeTruthy();
        }
    });
});

// Extended markdown syntaxes (SYNTAX-01, CodenameFlux review): ==highlight==,
// ^sup^/~sub~, definition lists and {#custom-id} heading ids. Exports capture
// the preview DOM, so asserting the rendered elements covers exports too.
describe("extended markdown syntax", () => {
    it("renders mark, sup, sub, definition lists and a custom heading id", async () => {
        const md = [
            "# My Title {#custom-id}",
            "",
            "Water is H~2~O and E = mc^2^, said the ==highlighted== part.",
            "",
            "Term one",
            ": The first definition",
        ].join("\n");
        const { container } = renderPreview(md);
        await waitFor(() => expect(container.querySelector("mark")).toBeTruthy());
        expect(container.querySelector("mark")!.textContent).toBe("highlighted");
        expect(container.querySelector("sub")!.textContent).toBe("2");
        expect(container.querySelector("sup")!.textContent).toBe("2");
        expect(container.querySelector("dl")).toBeTruthy();
        expect(container.querySelector("dt")!.textContent).toBe("Term one");
        expect(container.querySelector("dd")!.textContent).toContain("The first definition");
        const h1 = container.querySelector("h1")!;
        expect(h1.id).toBe("custom-id");
        // The {#custom-id} marker itself must not leak into the rendered text.
        expect(h1.textContent).not.toContain("{#custom-id}");
    });

    it("keeps GFM strikethrough (~~) working next to mark (==) and sub (~)", async () => {
        const { container } = renderPreview("==x== then ~~y~~ then ~z~");
        await waitFor(() => expect(container.querySelector("mark")).toBeTruthy());
        expect(container.querySelector("mark")!.textContent).toBe("x");
        expect(container.querySelector("del")!.textContent).toBe("y");
        expect(container.querySelector("sub")!.textContent).toBe("z");
    });

    it("still gives headings without {#id} their slug id (fallback intact)", async () => {
        const { container } = renderPreview("## Regular Heading\n\n## Regular Heading");
        const headings = await waitFor(() => {
            const hs = Array.from(container.querySelectorAll<HTMLHeadingElement>("h2"));
            expect(hs.length).toBe(2);
            return hs;
        });
        expect(headings[0].id).toBe("regular-heading");
        // Dedup suffixing must survive the custom-id change too.
        expect(headings[1].id).toBe("regular-heading-1");
    });

    it("keeps GFM task lists working alongside the new plugins", async () => {
        const { container } = renderPreview("- [ ] open item\n- [x] done item");
        await waitFor(() => {
            const boxes = container.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
            expect(boxes.length).toBe(2);
            expect(boxes[1].checked).toBe(true);
        });
    });

    // The npm remark-supersub plugin split text on ANY even marker count,
    // corrupting ordinary prose. The local plugin requires Pandoc's rule:
    // non-empty content with no whitespace between the markers.
    it("leaves prose with unpaired or spaced markers untouched", async () => {
        const md = [
            "x^2 + y^2 stays literal",
            "",
            "edit ~/.config and ~/.bashrc now",
            "",
            "see [^a] and [^b] here",
        ].join("\n");
        const { container } = renderPreview(md);
        await waitFor(() => expect(container.textContent).toContain("x^2 + y^2 stays literal"));
        expect(container.querySelector("sup")).toBeFalsy();
        expect(container.querySelector("sub")).toBeFalsy();
        expect(container.textContent).toContain("edit ~/.config and ~/.bashrc now");
        expect(container.textContent).toContain("see [^a] and [^b] here");
    });

    it("rejects {#ids} that are not valid anchors and dedupes repeated custom ids", async () => {
        const md = [
            "# Bad One {#My Id}",
            "",
            "# Twin {#dup}",
            "",
            "# Other Twin {#dup}",
        ].join("\n");
        const { container } = renderPreview(md);
        const headings = await waitFor(() => {
            const hs = Array.from(container.querySelectorAll<HTMLHeadingElement>("h1"));
            expect(hs.length).toBe(3);
            return hs;
        });
        // Invalid id (space) stays literal text and falls back to the slug.
        expect(headings[0].textContent).toContain("{#My Id}");
        expect(headings[0].id).not.toBe("My Id");
        // Duplicate custom ids must not produce duplicate DOM ids.
        expect(headings[1].id).toBe("dup");
        expect(headings[2].id).toBe("dup-1");
    });

    it("does not mangle tildes inside inline math when KaTeX is active", async () => {
        // hasMath() triggers the lazy math chain; remark-math extracts $a~b$
        // into an inlineMath node at parse time, so remark-supersub must only
        // see the ~z~ outside the math span.
        const { container } = renderPreview("$a~b$ stays math but ~z~ is sub");
        await waitFor(() => expect(container.querySelector(".katex")).toBeTruthy(), { timeout: 10000 });
        const sub = container.querySelector("sub");
        expect(sub).toBeTruthy();
        expect(sub!.textContent).toBe("z");
        // The math span must not contain a <sub> injected by supersub.
        expect(container.querySelector(".katex sub")).toBeFalsy();
    }, 15000);
});

// Relative .md links used to render as href="#" with the target held only in
// the onClick closure — exports captured dead anchors. The real href must be
// in the DOM, with in-app navigation still going through the callback.
describe("relative markdown links", () => {
    it("renders the real href and navigates in-app on click", async () => {
        const onNavigateRelative = vi.fn();
        const { container } = renderPreview("[other](notes/other.md)", { onNavigateRelative });
        const link = await waitFor(() => {
            const a = container.querySelector<HTMLAnchorElement>("a[data-relative-md]");
            expect(a).toBeTruthy();
            return a!;
        });
        expect(link.getAttribute("href")).toBe("notes/other.md");

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        link.dispatchEvent(click);
        expect(onNavigateRelative).toHaveBeenCalledWith("notes/other.md");
        // preventDefault must fire or the webview would navigate to the .md URL.
        expect(click.defaultPrevented).toBe(true);
    });
});

// PERF-02: the preview renders block by block. Whatever the splitter does, the
// result must be the same HTML the whole-document render produces. An unused
// footnote definition renders nothing but forces the whole-document path, so
// the two renders can be compared directly.
describe("block-by-block rendering (PERF-02)", () => {
    const FIXTURE = [
        "# Title",
        "",
        "Intro with a [ref link][docs], a [[Wiki Note]] and a #tag.",
        "",
        "## Setup",
        "",
        "- plain item",
        "- [ ] open task",
        "- [x] done task",
        "  - nested",
        "",
        "- loose item after a blank line",
        "",
        "1. one",
        "",
        "2. two",
        "",
        "```js",
        "const a = 1;",
        "",
        "",
        "const b = 2;",
        "```",
        "",
        "<details>",
        "<summary>More</summary>",
        "",
        "Hidden **markdown** inside.",
        "",
        "</details>",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "> [!tip] Callout",
        "> Body text.",
        "",
        "Term",
        ": Definition",
        "",
        "<!-- a comment",
        "",
        "spanning lines -->",
        "",
        "## Setup",
        "",
        "    indented code",
        "",
        "Final paragraph.",
        "",
        "[docs]: https://example.com",
    ].join("\n");

    const normalized = async (content: string) => {
        const { container, unmount } = renderPreview(content);
        const body = await waitFor(() => {
            const el = container.querySelector(".markdown-body") as HTMLElement;
            expect(el.textContent).toContain("Final paragraph.");
            return el;
        });
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".md-block").forEach((w) => w.replaceWith(...Array.from(w.childNodes)));
        clone.querySelectorAll("[data-source-line]").forEach((el) => el.removeAttribute("data-source-line"));
        // react-markdown separates top-level elements with newline text
        // nodes; they don't render, and block boundaries naturally drop some.
        const html = clone.innerHTML.replace(/>\n+</g, "><");
        unmount();
        return html;
    };

    it("renders exactly what the whole-document render produces", async () => {
        const blocks = await normalized(FIXTURE);
        const whole = await normalized(`${FIXTURE}\n\n[^unused]: forces the whole-document path`);
        expect(blocks).toBe(whole);
        // Sanity: the fixture really exercised the interesting parts.
        expect(blocks).toContain("<details>");
        expect(blocks).toContain('href="https://example.com"');
        expect(blocks).toContain('id="setup-1"');
    });

    it("reports absolute source lines across blocks (scroll sync, TOC, goto-line)", async () => {
        const { container } = renderPreview("para one\n\npara two\n\n\n## Heading at line 6");
        const h2 = await waitFor(() => {
            const el = container.querySelector("h2");
            expect(el).toBeTruthy();
            return el!;
        });
        const rel = Number(h2.getAttribute("data-source-line"));
        const offset = Number(h2.parentElement?.getAttribute("data-line-offset") ?? 0);
        expect(rel + offset).toBe(6);
    });

    it("toggles the right source line for a task in a later block", async () => {
        const onContentChange = vi.fn();
        const content = ["---", "title: x", "---", "# Head", "", "Intro.", "", "- [ ] first", "- [ ] second"].join("\n");
        const { container } = renderPreview(content, { onContentChange });
        const boxes = await waitFor(() => {
            const bs = container.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
            expect(bs.length).toBe(2);
            return bs;
        });
        boxes[1].click();
        expect(onContentChange).toHaveBeenCalledWith(content.replace("- [ ] second", "- [x] second"));
    });
});
