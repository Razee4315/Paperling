/**
 * Pure helpers for `[[wikilink]]` autocomplete. Kept out of the editor so the
 * matching and ranking can be unit-tested without a CodeMirror instance.
 */

/**
 * Detect an open `[[` immediately before the cursor on the current line.
 * Returns the offset (within `textBefore`) where the link target starts and the
 * text typed so far, or null when the cursor isn't inside a wikilink target.
 *
 * Returns null once a `|` is typed (that's the alias, not a file to complete)
 * and never matches across a `]` or newline.
 */
export function matchWikilinkPrefix(textBefore: string): { from: number; query: string } | null {
  const m = /\[\[([^\]\n]*)$/.exec(textBefore);
  if (!m) return null;
  const query = m[1];
  if (query.includes("|")) return null; // completing the alias, not the target
  return { from: m.index + 2, query };
}

/**
 * Filter and rank candidate file names against a query. Prefix matches rank
 * above mid-string matches; ties break by match position, then length, then
 * alphabetically. An empty query returns everything (capped), so just typing
 * `[[` lists the folder.
 */
export function rankFileNames(names: string[], query: string, limit = 50): string[] {
  const q = query.toLowerCase();
  const scored: { name: string; rank: number; idx: number; len: number }[] = [];
  for (const name of names) {
    const idx = name.toLowerCase().indexOf(q);
    if (q && idx === -1) continue;
    scored.push({ name, rank: q === "" || idx === 0 ? 0 : 1, idx: idx < 0 ? 0 : idx, len: name.length });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.idx - b.idx || a.len - b.len || a.name.localeCompare(b.name)
  );
  return scored.slice(0, limit).map((s) => s.name);
}

/** Strip a trailing .md / .markdown extension for display as a wikilink target. */
export function toWikiName(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, "");
}
