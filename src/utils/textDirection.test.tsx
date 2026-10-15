import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    firstStrongDirection,
    lineDirection,
    rehypeBlockDirection,
    createDirectionChord,
    isTextDirection,
    type DirectionChordKey,
} from "./textDirection";

describe("firstStrongDirection (BIDI-01)", () => {
    it("detects right-to-left scripts", () => {
        expect(firstStrongDirection("مرحبا بالعالم")).toBe("rtl"); // Arabic
        expect(firstStrongDirection("שלום עולם")).toBe("rtl"); // Hebrew
        expect(firstStrongDirection("سلام دنیا")).toBe("rtl"); // Persian
        expect(firstStrongDirection("ہیلو دنیا")).toBe("rtl"); // Urdu
    });

    it("detects left-to-right scripts, including non-Latin ones", () => {
        expect(firstStrongDirection("Hello")).toBe("ltr");
        expect(firstStrongDirection("Привет")).toBe("ltr");
        expect(firstStrongDirection("你好")).toBe("ltr");
    });

    it("skips neutrals and uses the FIRST strong character", () => {
        expect(firstStrongDirection("123, — مرحبا hello")).toBe("rtl");
        expect(firstStrongDirection("  42 hello مرحبا")).toBe("ltr");
    });

    it("returns null when there is no strong character", () => {
        expect(firstStrongDirection("")).toBeNull();
        expect(firstStrongDirection("--- 123 !?")).toBeNull();
    });
});

describe("lineDirection (markdown source lines)", () => {
    it("ignores markdown markers", () => {
        expect(lineDirection("# عنوان")).toBe("rtl");
        expect(lineDirection("- [ ] مهمة")).toBe("rtl");
        expect(lineDirection("> اقتباس")).toBe("rtl");
        expect(lineDirection("1. שלום")).toBe("rtl");
    });

    it("ignores inline code, link targets and HTML tags", () => {
        expect(lineDirection("`npm install` ثم شغل")).toBe("rtl");
        expect(lineDirection("[رابط](https://example.com)")).toBe("rtl");
        expect(lineDirection("<b>مرحبا</b>")).toBe("rtl");
    });

    it("keeps English lines LTR", () => {
        expect(lineDirection("## Setup")).toBe("ltr");
        expect(lineDirection("Use `مرحبا` as the key")).toBe("ltr");
    });
});

// Rendered through react-markdown, as in the preview.
async function render(md: string): Promise<string> {
    return renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeBlockDirection]}>{md}</ReactMarkdown>,
    );
}

describe("rehypeBlockDirection (preview)", () => {
    it("emits nothing for a purely left-to-right document", async () => {
        const html = await render("# Title\n\nSome text.\n\n- a\n- b\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
        expect(html).not.toContain("dir=");
    });

    it("marks right-to-left blocks", async () => {
        const html = await render("# عنوان\n\nهذا نص عربي.\n\nEnglish paragraph.\n");
        expect(html).toContain('<h1 dir="rtl">عنوان</h1>');
        expect(html).toContain('<p dir="rtl">هذا نص عربي.</p>');
        expect(html).toContain("<p>English paragraph.</p>");
    });

    it("gives a list one direction as a whole (items are not flipped)", async () => {
        const html = await render("- أول\n- second\n");
        expect(html).toContain('<ul dir="rtl">');
        expect(html).not.toMatch(/<li dir=/);
    });

    it("switches an English paragraph back to LTR inside an RTL quote", async () => {
        const html = await render("> اقتباس عربي\n>\n> English inside\n");
        expect(html).toContain('<blockquote dir="rtl">');
        expect(html).toContain('<p dir="ltr">English inside</p>');
    });

    it("never touches code blocks and ignores inline code when detecting", async () => {
        const html = await render("```\nمرحبا\n```\n\n`code` ثم نص\n");
        expect(html).toMatch(/<pre><code>مرحبا/);
        expect(html).toContain('<p dir="rtl"><code>code</code> ثم نص</p>');
    });

    it("directs table cells as a table", async () => {
        const html = await render("| الاسم | العمر |\n|---|---|\n| علي | 30 |\n");
        expect(html).toContain('<table dir="rtl">');
    });
});

const key = (k: string, over: Partial<DirectionChordKey> = {}): DirectionChordKey => ({
    key: k,
    location: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over,
});

describe("createDirectionChord (Ctrl+Shift reading order, BIDI-02)", () => {
    it("Ctrl + Right Shift, released alone, switches to RTL", () => {
        const c = createDirectionChord();
        c.keydown(key("Control", { ctrlKey: true, location: 1 }));
        c.keydown(key("Shift", { ctrlKey: true, shiftKey: true, location: 2 }));
        expect(c.keyup(key("Shift", { ctrlKey: true, location: 2 }))).toBe("rtl");
    });

    it("Ctrl + Left Shift switches back to auto", () => {
        const c = createDirectionChord();
        c.keydown(key("Control", { ctrlKey: true, location: 1 }));
        c.keydown(key("Shift", { ctrlKey: true, shiftKey: true, location: 1 }));
        expect(c.keyup(key("Control", { shiftKey: true, location: 1 }))).toBe("auto");
    });

    it("works with Shift pressed before Ctrl (side comes from the Shift key)", () => {
        const c = createDirectionChord();
        c.keydown(key("Shift", { shiftKey: true, location: 2 }));
        c.keydown(key("Control", { ctrlKey: true, shiftKey: true, location: 1 }));
        expect(c.keyup(key("Control", { shiftKey: true, location: 1 }))).toBe("rtl");
    });

    it("fires once per chord, not again on the second key release", () => {
        const c = createDirectionChord();
        c.keydown(key("Control", { ctrlKey: true, location: 1 }));
        c.keydown(key("Shift", { ctrlKey: true, shiftKey: true, location: 2 }));
        expect(c.keyup(key("Shift", { ctrlKey: true, location: 2 }))).toBe("rtl");
        expect(c.keyup(key("Control", { location: 1 }))).toBeNull();
    });

    it("a Ctrl+Shift+<key> shortcut never triggers it", () => {
        const c = createDirectionChord();
        c.keydown(key("Control", { ctrlKey: true, location: 1 }));
        c.keydown(key("Shift", { ctrlKey: true, shiftKey: true, location: 2 }));
        c.keydown(key("F", { ctrlKey: true, shiftKey: true }));
        expect(c.keyup(key("Shift", { ctrlKey: true, location: 2 }))).toBeNull();
    });

    it("AltGr (Ctrl+Alt) and Ctrl alone never trigger it", () => {
        const c = createDirectionChord();
        c.keydown(key("Control", { ctrlKey: true, altKey: true, location: 1 }));
        c.keydown(key("Shift", { ctrlKey: true, altKey: true, shiftKey: true, location: 2 }));
        expect(c.keyup(key("Shift", { ctrlKey: true, altKey: true, location: 2 }))).toBeNull();
        c.keydown(key("Control", { ctrlKey: true, location: 1 }));
        expect(c.keyup(key("Control", { location: 1 }))).toBeNull();
    });

    it("reset() (editor blur) disarms a half-pressed chord", () => {
        const c = createDirectionChord();
        c.keydown(key("Control", { ctrlKey: true, location: 1 }));
        c.keydown(key("Shift", { ctrlKey: true, shiftKey: true, location: 2 }));
        c.reset();
        expect(c.keyup(key("Shift", { ctrlKey: true, location: 2 }))).toBeNull();
    });
});

describe("isTextDirection", () => {
    it("accepts only the three modes", () => {
        expect(isTextDirection("auto")).toBe(true);
        expect(isTextDirection("rtl")).toBe(true);
        expect(isTextDirection("ltr")).toBe(true);
        expect(isTextDirection("RTL")).toBe(false);
        expect(isTextDirection(null)).toBe(false);
    });
});
