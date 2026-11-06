import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { errMessage } from "./errors";
import { pathKey } from "./tabsModel";
import { fileHistory } from "./fileHistory";

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
 *
 * Other encodings (ENC-02/03): read_file decodes UTF-16 and legacy files and
 * reports how the file is stored. That is remembered per path here and handed
 * back on every save, so editing a file never changes its encoding behind the
 * user's back. ENC-04 covers the text an encoding cannot hold.
 */

const BOM = "﻿";
const bomPaths = new Set<string>();

/** How a document is stored. Keep in step with TextEncoding in text_encoding.rs. */
export type FileEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "windows-1252";

const ENCODING_NAMES: Record<FileEncoding, string> = {
    "utf-8": "UTF-8",
    "utf-8-bom": "UTF-8 BOM",
    "utf-16le": "UTF-16 LE",
    "utf-16be": "UTF-16 BE",
    "windows-1252": "Windows-1252",
};

const encodings = new Map<string, FileEncoding>();
const encodingListeners = new Set<() => void>();

function notifyEncodingChange(): void {
    for (const listener of encodingListeners) listener();
}

function rememberEncoding(key: string, encoding: FileEncoding | undefined): void {
    if (encodings.get(key) === encoding) return;
    if (encoding) encodings.set(key, encoding);
    else encodings.delete(key);
    notifyEncodingChange();
}

/** Run `listener` whenever a remembered encoding changes. ENC-05. */
export function subscribeEncodings(listener: () => void): () => void {
    encodingListeners.add(listener);
    return () => {
        encodingListeners.delete(listener);
    };
}

/** The status bar's name for `path`'s encoding; null for plain UTF-8. ENC-05. */
export function encodingLabel(path: string | null): string | null {
    const encoding = path ? encodings.get(pathKey(path)) : undefined;
    return encoding && encoding !== "utf-8" ? ENCODING_NAMES[encoding] : null;
}

/**
 * Keep remembered encodings with their files when a file or a whole folder is
 * renamed; a null `newPath` (moved to the trash) forgets them. ENC-03.
 */
export function retargetEncodings(oldPath: string, newPath: string | null): void {
    const oldKey = pathKey(oldPath);
    const newKey = newPath === null ? null : pathKey(newPath);
    let changed = false;
    for (const [key, encoding] of [...encodings]) {
        if (key !== oldKey && !key.startsWith(`${oldKey}/`)) continue;
        encodings.delete(key);
        if (newKey !== null) encodings.set(newKey + key.slice(oldKey.length), encoding);
        changed = true;
    }
    if (changed) notifyEncodingChange();
}

/** Did the last read of `path` carry a BOM? (exported for tests) */
export function hadBom(path: string): boolean {
    return bomPaths.has(pathKey(path));
}

/** Read a document, BOM stripped (and remembered for the save side). */
export async function readTextFile<T extends { content: string; path?: string; encoding?: FileEncoding }>(
    path: string,
): Promise<T> {
    const data = await invoke<T>("read_file", { path });
    if (data) rememberEncoding(pathKey(data.path ?? path), data.encoding);
    if (data && typeof data.content === "string" && data.content.startsWith(BOM)) {
        bomPaths.add(pathKey(data.path ?? path));
        const stripped = data.content.slice(BOM.length);
        void fileHistory.record(path, stripped, "opened");
        return { ...data, content: stripped };
    }
    bomPaths.delete(pathKey(path));
    if (data && typeof data.content === "string") void fileHistory.record(path, data.content, "opened");
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

async function writeDocument(args: { path: string; content: string; encoding?: FileEncoding }): Promise<number> {
    writesInFlight++;
    writeEpoch++;
    try {
        return await invoke<number>("save_file", args);
    } finally {
        writesInFlight--;
        writeEpoch++;
    }
}

export interface SaveOptions {
    /** A save nobody asked for (autosave): it must never open a dialog. */
    background?: boolean;
}

/** save_file's refusal; pinned by a Rust test. ENC-04. */
const UNREPRESENTABLE = /^Unrepresentable text: (\S+) cannot store U\+([0-9A-F]+)$/;

const diskMtime = (path: string): Promise<number | undefined> =>
    invoke<{ modified: number }>("get_file_info", { path }).then(
        (info) => info?.modified,
        () => undefined,
    );

/**
 * The document holds a character its file's encoding cannot store, and nothing
 * has been written. Converting is the user's call, so it is asked for here,
 * where every save path passes. ENC-04.
 *
 * Autosave only reports: a dialog appearing mid-sentence could be answered by
 * the next Enter or Space. The text stays safe and unsaved in the editor, and
 * the next deliberate save asks.
 *
 * The question can stay open for minutes, so the write counter is not held
 * while it is, and another program's write in that time cancels the save: the
 * conflict check ran before the dialog opened and cannot see it.
 */
async function convertToUtf8(path: string, content: string, refusal: RegExpExecArray, background: boolean): Promise<number> {
    const name = path.replace(/\\/g, "/").split("/").pop() || path;
    const stored = ENCODING_NAMES[refusal[1] as FileEncoding] ?? refusal[1];
    const character = `"${String.fromCodePoint(parseInt(refusal[2], 16))}" (U+${refusal[2]})`;
    const problem = `Not saved: "${name}" is stored as ${stored}, which can't hold ${character}`;
    if (background) throw new Error(`${problem}. Save it yourself to convert it to UTF-8.`);

    const seenMtime = await diskMtime(path);
    const convert = await ask(
        `"${name}" is stored as ${stored}, which can't hold ${character}.\n\n` +
            "Convert the file to UTF-8? All your text is kept, but programs that expect " +
            `${stored} may not read it correctly.\n\n` +
            "Don't save leaves the file on disk as it is. Your text stays in the editor.",
        { title: "Convert to UTF-8?", kind: "warning", okLabel: "Convert to UTF-8", cancelLabel: "Don't save" },
    );
    if (!convert) throw new Error(`${problem}.`);
    if ((await diskMtime(path)) !== seenMtime) {
        throw new Error(`Not saved: "${name}" changed on disk while Paperling was asking.`);
    }
    const mtime = await writeDocument({ path, content, encoding: "utf-8" });
    rememberEncoding(pathKey(path), "utf-8");
    return mtime;
}

/**
 * Save a document in the encoding it was read with, re-adding its BOM. Resolves
 * the new mtime. A path never read here sends no encoding: save_file then keeps
 * whatever the file on disk uses.
 */
export async function saveTextFile(path: string, content: string, { background = false }: SaveOptions = {}): Promise<number> {
    const out = hadBom(path) && !content.startsWith(BOM) ? BOM + content : content;
    const encoding = encodings.get(pathKey(path));
    let mtime: number;
    try {
        mtime = await writeDocument({ path, content: out, ...(encoding ? { encoding } : {}) });
    } catch (error) {
        const refusal = UNREPRESENTABLE.exec(errMessage(error));
        if (!refusal) throw error;
        mtime = await convertToUtf8(path, out, refusal, background);
    }
    // Only after a write landed: a refused attempt saved nothing to remember.
    void fileHistory.record(path, content, "saved");
    return mtime;
}
