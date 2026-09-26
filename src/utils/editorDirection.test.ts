import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { textDirectionExtension } from "./editorDirection";
import type { TextDirection } from "./textDirection";

let view: EditorView | null = null;
afterEach(() => {
    view?.destroy();
    view = null;
});

function mount(doc: string, direction: TextDirection): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [textDirectionExtension(direction)] }) });
    return view;
}

const lineDirs = (v: EditorView) =>
    Array.from(v.contentDOM.querySelectorAll(".cm-line")).map((l) => l.getAttribute("dir"));

describe("textDirectionExtension (BIDI-01, #216)", () => {
    it("auto: RTL lines get dir=rtl, LTR lines are left alone", () => {
        const v = mount("# عنوان\nEnglish line\n- عنصر\n\n```", "auto");
        expect(lineDirs(v)).toEqual(["rtl", null, "rtl", null, null]);
        expect(v.contentDOM.getAttribute("dir")).toBeNull();
    });

    it("auto: follows edits (typing Arabic into a blank line flips it)", () => {
        const v = mount("hello\n", "auto");
        v.dispatch({ changes: { from: v.state.doc.length, insert: "مرحبا" } });
        expect(lineDirs(v)).toEqual([null, "rtl"]);
    });

    it("forced rtl/ltr put one direction on the content element", () => {
        const r = mount("hello", "rtl");
        expect(r.contentDOM.getAttribute("dir")).toBe("rtl");
        expect(lineDirs(r)).toEqual([null]);
        r.destroy();
        view = null;
        const l = mount("مرحبا", "ltr");
        expect(l.contentDOM.getAttribute("dir")).toBe("ltr");
        expect(lineDirs(l)).toEqual([null]);
    });
});
