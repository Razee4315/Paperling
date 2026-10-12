import { invoke } from "@tauri-apps/api/core";
import { pathKey } from "./tabsModel";

/**
 * Text-file I/O for documents, layered on the Rust read_file / save_file
 * commands. Every read and write of a USER DOCUMENT goes through here so
 * encoding details are handled in one place.
 *
 * UTF-8 BOM (ENC-01): Notepad, older Office tools and many Windows exporters
 * start files with U+FEFF. Rust's read_to_string keeps it, so the editor got
 * an invisible first character: frontmatter (`^---`) stopped being
 * recognised and rendered as an <hr> plus a giant setext heading, and a
 * leading `# Title` was no longer a heading. The BOM is stripped on read and
 * remembered per path, then restored on save, so the file round-trips
 * byte-identically and a BOM file never looks "changed" to other tools.
 */

const BOM = "﻿";
const bomPaths = new Set<string>();

/** Did the last read of `path` carry a BOM? (exported for tests) */
export function hadBom(path: string): boolean {
    return bomPaths.has(pathKey(path));
}

/** Read a document, BOM stripped (and remembered for the save side). */
export async function readTextFile<T extends { content: string; path?: string }>(path: string): Promise<T> {
    const data = await invoke<T>("read_file", { path });
    if (data && typeof data.content === "string" && data.content.startsWith(BOM)) {
        bomPaths.add(pathKey(data.path ?? path));
        return { ...data, content: data.content.slice(BOM.length) };
    }
    bomPaths.delete(pathKey(path));
    return data;
}

/**
 * Our own writes, as seen by the external-change checks (EXT-08). Those checks
 * stat open files every 1.5 s (EXT-07). A stat that lands while one of our
 * saves is in flight sees the new mtime before the save path has recorded it,
 * so Paperling's own autosave was reported as a change "on disk": a false
 * conflict dialog on the active tab, and on a background tab an error toast
 * plus parked autosave. A check takes a token before its stat and drops the
 * result when the token has changed by the time the stat returns.
 *
 * The counter moves when a write starts and again when it ends, and every
 * caller records the returned mtime synchronously after its await, so by the
 * time a later check can run, the new mtime is already known.
 */
let writesInFlight = 0;
let writeEpoch = 0;

/** A token for "none of our writes is running"; null while one is. EXT-08. */
export function idleWriteToken(): number | null {
    return writesInFlight > 0 ? null : writeEpoch;
}

/** Save a document; re-adds the BOM the file was read with. Resolves the new mtime. */
export async function saveTextFile(path: string, content: string): Promise<number> {
    const out = hadBom(path) && !content.startsWith(BOM) ? BOM + content : content;
    writesInFlight++;
    writeEpoch++;
    try {
        return await invoke<number>("save_file", { path, content: out });
    } finally {
        writesInFlight--;
        writeEpoch++;
    }
}
