/**
 * Find, in the markdown SOURCE, the text a user selected in the rendered
 * reader, so switching to the editor can put the caret right on it. MODE-03.
 *
 * Rendered text and source differ by markdown syntax ("bold word" in the
 * reader is "**bold** word" in the source), so after an exact search the
 * words are matched with any run of whitespace or markdown punctuation
 * between them. The search starts at the source line of the block the
 * selection was in and only looks a limited distance ahead, so a common
 * word lands in the right paragraph, not its first occurrence in the note.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// What markdown can put between two rendered words.
const GAP = "[\\s*_~`=\\[\\]()!#>|:-]*";

export function locateText(doc: string, startLine: number, text: string, maxLines = 80): { from: number; to: number } | null {
    const wanted = text.split("\n")[0].replace(/\s+/g, " ").trim();
    if (!wanted) return null;
    // Offset of startLine (1-based) and of startLine + maxLines.
    let from = 0;
    for (let line = 1; line < startLine && from !== -1; line++) {
        from = doc.indexOf("\n", from);
        if (from !== -1) from += 1;
    }
    if (from === -1) from = 0;
    let to = from;
    for (let i = 0; i < maxLines && to !== -1; i++) {
        to = doc.indexOf("\n", to + 1);
    }
    if (to === -1) to = doc.length;
    const region = doc.slice(from, to);

    const exact = region.indexOf(wanted);
    if (exact !== -1) return { from: from + exact, to: from + exact + wanted.length };

    const words = wanted.split(" ").filter(Boolean).slice(0, 12);
    const loose = new RegExp(words.map(escape).join(GAP), "u");
    const m = loose.exec(region);
    if (m) return { from: from + m.index, to: from + m.index + m[0].length };

    // Last resort: the longest word that is actually there.
    for (const word of [...words].sort((a, b) => b.length - a.length)) {
        if (word.length < 3) break;
        const i = region.indexOf(word);
        if (i !== -1) return { from: from + i, to: from + i + word.length };
    }
    return null;
}
