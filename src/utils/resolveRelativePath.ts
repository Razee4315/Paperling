/**
 * Resolve a relative markdown link (`note.md`, `sub/note.md`, `../other.md`)
 * against the directory of the currently open file, the way a browser resolves a
 * relative href. Returns an absolute path using the same separator style as
 * `baseFilePath`, or null when there's nothing to resolve.
 *
 * - Any `#fragment` is dropped (we navigate to the file, not a sub-anchor).
 * - `.` and empty segments are skipped; `..` pops a directory (never above root).
 * - Percent-encoding in segments is decoded (`my%20note.md` → `my note.md`).
 */
export function resolveRelativePath(baseFilePath: string, href: string): string | null {
  if (!baseFilePath) return null;
  const hashIdx = href.indexOf("#");
  const rel = (hashIdx >= 0 ? href.slice(0, hashIdx) : href).trim();
  if (!rel || rel.includes("\0")) return null;

  const sep = baseFilePath.includes("\\") ? "\\" : "/";
  const lastSep = Math.max(baseFilePath.lastIndexOf("/"), baseFilePath.lastIndexOf("\\"));
  // lastSep === 0 means a root-level file ("/a.md"): the directory is "/", which
  // splits to [""] so the leading separator is preserved. -1 means no directory.
  const parts = lastSep >= 0 ? baseFilePath.slice(0, lastSep).split(/[\\/]/) : [];

  for (const raw of rel.split(/[\\/]/)) {
    let seg: string;
    try { seg = decodeURIComponent(raw); } catch { seg = raw; }
    if (seg === "" || seg === ".") continue;
    // `..` climbs one directory but never past the root. The leading "" marker
    // (from an absolute "/path") represents root, so don't pop it away.
    if (seg === "..") { if (parts.length && parts[parts.length - 1] !== "") parts.pop(); }
    else parts.push(seg);
  }

  const resolved = parts.join(sep);
  return resolved || null;
}
