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

/** Save a document; re-adds the BOM the file was read with. Resolves the new mtime. */
export function saveTextFile(path: string, content: string): Promise<number> {
    const out = hadBom(path) && !content.startsWith(BOM) ? BOM + content : content;
    return invoke<number>("save_file", { path, content: out });
}
