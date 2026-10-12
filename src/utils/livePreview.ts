import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// LIVE-01: "live preview" for the Code editor. The editor showed every
// Markdown symbol all the time, which reads as noise to anyone who does not
// think in syntax. With this on, the marks around headings, emphasis, inline
// code and links are hidden on every line except the ones the caret or
// selection touches, where the raw source comes back so it can be edited.
// Nothing is rewritten: these are view decorations over the same text.
//
// Deliberately narrow. Lists, quotes, tables, code blocks, images and note
// syntax stay as typed; hiding those needs widgets and its own editing rules.

export interface LivePreviewMarks {
    /** Source ranges to hide. Never spans a line break. */
    hidden: { from: number; to: number }[];
    /** Line starts of ATX headings, with their level, for sizing. */
    headings: { pos: number; level: number }[];
}

/** Blocks whose contents are literal or have their own layout. */
const OPAQUE = /^(FencedCode|CodeBlock|HTMLBlock|Table|CommentBlock)$/;

/**
 * What to hide and which lines are headings between `from` and `to`. Pure, so
 * it can be tested without a view; the plugin calls it for the visible ranges
 * only, so a long note costs what is on screen.
 */
export function livePreviewMarks(state: EditorState, from: number, to: number): LivePreviewMarks {
    const doc = state.doc;
    // Lines being worked on keep their syntax.
    const active = state.selection.ranges.map((range) => [doc.lineAt(range.from).number, doc.lineAt(range.to).number] as const);
    const isActive = (pos: number) => {
        const line = doc.lineAt(pos).number;
        return active.some(([first, last]) => line >= first && line <= last);
    };
    const hidden: LivePreviewMarks["hidden"] = [];
    const headings: LivePreviewMarks["headings"] = [];
    const hide = (start: number, end: number) => { if (end > start && !isActive(start)) hidden.push({ from: start, to: end }); };

    syntaxTree(state).iterate({
        from,
        to,
        enter(node) {
            const name = node.name;
            if (OPAQUE.test(name)) return false;
            const heading = /^ATXHeading([1-6])$/.exec(name);
            if (heading) {
                // Sized whether or not the caret is on it, so moving through a
                // note does not make lines jump in height.
                headings.push({ pos: doc.lineAt(node.from).from, level: Number(heading[1]) });
                return;
            }
            if (name === "HeaderMark") {
                const parent = node.node.parent;
                // Only the opening run of #; a closing "##" and Setext
                // underlines are left alone.
                if (parent && /^ATXHeading/.test(parent.name) && node.from === parent.from) {
                    hide(node.from, doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to);
                }
                return;
            }
            if (name === "EmphasisMark" || name === "StrikethroughMark") { hide(node.from, node.to); return; }
            if (name === "CodeMark") {
                if (node.node.parent?.name === "InlineCode") hide(node.from, node.to);
                return;
            }
            if (name === "Link") {
                // Inline links only: [text](url) has the marks "[", "]", "(", ")".
                // Reference links and autolinks keep their source.
                const marks = node.node.getChildren("LinkMark");
                if (marks.length >= 4 && node.node.getChild("URL") && doc.lineAt(node.from).number === doc.lineAt(node.to).number) {
                    hide(marks[0].from, marks[0].to);
                    hide(marks[1].from, node.to);
                }
            }
        },
    });
    return { hidden, headings };
}

const hiddenMark = Decoration.replace({});
const headingLine = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-lp-heading cm-lp-h${level}` }));

function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
        const marks = livePreviewMarks(view.state, from, to);
        for (const range of marks.hidden) ranges.push(hiddenMark.range(range.from, range.to));
        for (const heading of marks.headings) ranges.push(headingLine[heading.level - 1].range(heading.pos));
    }
    return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = build(view); }
        update(update: ViewUpdate) {
            if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
                this.decorations = build(update.view);
            }
        }
    },
    { decorations: (value) => value.decorations },
);

const theme = EditorView.baseTheme({
    ".cm-lp-heading": { fontWeight: "700", lineHeight: "1.4" },
    ".cm-lp-h1": { fontSize: "1.7em" },
    ".cm-lp-h2": { fontSize: "1.4em" },
    ".cm-lp-h3": { fontSize: "1.2em" },
    ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontSize: "1.05em" },
});

/** The editor extension; an empty array when the setting is off. */
export const livePreview = (enabled: boolean): Extension => (enabled ? [plugin, theme] : []);
