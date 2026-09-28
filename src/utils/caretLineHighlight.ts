import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";

/**
 * Active-line highlight that steps aside while text is selected (#146).
 *
 * CodeMirror's own `highlightActiveLine` decorates the line holding each
 * range's *head* whether or not that range is empty. The decoration lands on
 * the content line, which paints ABOVE the selection layer, so the line tint
 * sat on top of the selection on the one line every selection is guaranteed to
 * touch. Users reported exactly that: a selection they could not see.
 *
 * Making the tint semi-transparent only softened it (the selection still read
 * at ~1.2:1 against the line). Dropping the decoration entirely while a
 * selection exists is what the mainstream editors do, and it lets the tint stay
 * fully opaque for the caret-only case, where it is actually doing its job.
 */
const caretLine = Decoration.line({ class: "cm-activeLine" });

function caretLineDeco(view: EditorView): DecorationSet {
    const { ranges } = view.state.selection;
    if (ranges.some((r) => !r.empty)) return Decoration.none;

    const deco: Range<Decoration>[] = [];
    let lastLineStart = -1;
    for (const r of ranges) {
        const line = view.lineBlockAt(r.head);
        // Multiple cursors can share a line; decorate it once (CodeMirror's own
        // highlighter guards the same way, and a duplicate range throws).
        if (line.from > lastLineStart) {
            deco.push(caretLine.range(line.from));
            lastLineStart = line.from;
        }
    }
    return Decoration.set(deco);
}

export const highlightCaretLine = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = caretLineDeco(view);
        }
        update(update: ViewUpdate) {
            if (update.docChanged || update.selectionSet) this.decorations = caretLineDeco(update.view);
        }
    },
    { decorations: (v) => v.decorations },
);
