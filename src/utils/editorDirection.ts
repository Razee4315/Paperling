import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { lineDirection, type TextDirection } from "./textDirection";

// Shared decoration; CodeMirror compares decorations by identity. LTR lines
// get none: they simply inherit the editor's LTR direction.
const RTL_LINE = Decoration.line({ attributes: { dir: "rtl" } });

/**
 * Line decorations for the "auto" mode: every visible line whose first strong
 * character is right-to-left gets `dir="rtl"`. Only the viewport is scanned,
 * so this stays O(visible lines) on huge documents. BIDI-01 (#216).
 */
function autoLineDirections(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
            const line = doc.lineAt(pos);
            if (lineDirection(line.text) === "rtl") builder.add(line.from, line.from, RTL_LINE);
            pos = line.to + 1;
        }
    }
    return builder.finish();
}

const autoDirectionPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = autoLineDirections(view);
        }
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) this.decorations = autoLineDirections(update.view);
        }
    },
    { decorations: (v) => v.decorations },
);

/**
 * The editor extension for a text-direction setting.
 *
 * `perLineTextDirection` makes CodeMirror read each rendered line's own
 * direction, so arrow keys, Home/End and selection drawing follow the
 * reading order of that line instead of assuming the whole editor is LTR.
 * A forced direction goes on the content element (every line inherits it);
 * the gutter stays where it is, as in VS Code.
 */
export function textDirectionExtension(direction: TextDirection): Extension {
    if (direction === "auto") return [EditorView.perLineTextDirection.of(true), autoDirectionPlugin];
    return [EditorView.perLineTextDirection.of(true), EditorView.contentAttributes.of({ dir: direction })];
}
