// Editor-side highlight plumbing for the shared FindBar (FIND-01). A StateField
// holds the decoration set for find matches; the FindBar's editor controller
// pushes match ranges into it via the `setFindMatches` effect. Every match gets
// a dim mark (.cm-find-match); the active one additionally gets .cm-find-match-active
// (see index.css), mirroring the reader-mode preview highlight.

import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";

export interface FindRange {
    from: number;
    to: number;
}

export const setFindMatches = StateEffect.define<{ ranges: FindRange[]; activeIndex: number }>();

const matchMark = Decoration.mark({ class: "cm-find-match" });
const activeMark = Decoration.mark({ class: "cm-find-match cm-find-match-active" });

export const findHighlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
        for (const e of tr.effects) {
            if (e.is(setFindMatches)) {
                const builder = new RangeSetBuilder<Decoration>();
                e.value.ranges.forEach((r, i) => {
                    if (r.to > r.from) builder.add(r.from, r.to, i === e.value.activeIndex ? activeMark : matchMark);
                });
                return builder.finish();
            }
        }
        // No find effect this transaction: keep the marks aligned with edits.
        return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
});
