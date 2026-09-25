/**
 * DEV-ONLY in-memory Tauri backend for browser testing (`?fakefs=1`).
 *
 * Browser mode has no Rust, so every open/save/tab/conflict flow — the flows
 * users touch 90% of the time — was untestable outside a Test Build. This shim
 * installs a fake `window.__TAURI_INTERNALS__` that answers the app's commands
 * (read_file, save_file, get_file_info, list_directory_files, search_files, …)
 * from a small virtual disk persisted in localStorage (so a reload behaves like
 * an app restart), plus the dialog/event/window plugin calls.
 *
 * Loaded from main.tsx behind `import.meta.env.DEV`, so production bundles
 * never contain it. Test hooks live on `window.__fakefs`:
 *   __fakefs.write(path, text)       simulate an external edit (bumps mtime)
 *   __fakefs.read(path)              what's on "disk"
 *   __fakefs.nextOpen = [paths]      answer for the next Open dialog
 *   __fakefs.nextSave = path         answer for the next Save dialog
 *   __fakefs.nextAsk = true|false    answer for the next ask()/confirm()
 *   __fakefs.emit(event, payload)    fire a backend event (drag-drop, …)
 *   __fakefs.reset()                 restore the seed disk
 */

type Disk = Record<string, { content: string; modified: number }>;
const KEY = "paperling.fakefs.v1";
const ROOT = "C:\\Notes";

const SEED: Record<string, string> = {
    [`${ROOT}\\Welcome.md`]: [
        "---",
        "title: Welcome",
        "tags: [demo]",
        "---",
        "",
        "# Welcome to the notes folder",
        "",
        "This is a **fake disk** used for browser testing. Link to [[Ideas]] or [[Journal#Monday]].",
        "",
        "## Lists",
        "",
        "- first item",
        "- second item",
        "  - nested",
        "- [ ] a task",
        "- [x] done task",
        "",
        "1. one",
        "2. two",
        "",
        "## Code",
        "",
        "```ts",
        "const answer: number = 42;",
        "console.log(answer);",
        "```",
        "",
        "## Table",
        "",
        "| Name | Value |",
        "| ---- | ----- |",
        "| a    | 1     |",
        "| b    | 2     |",
        "",
        "> [!tip] Callout",
        "> Callouts render as boxes.",
        "",
        "Inline math $E = mc^2$ and a [link](https://example.com).",
        "",
    ].join("\n"),
    [`${ROOT}\\Ideas.md`]: "# Ideas\n\n- Build a better markdown app\n- Back to [[Welcome]]\n",
    [`${ROOT}\\Journal.md`]: "# Journal\n\n## Monday\n\nWrote code.\n\n## Tuesday\n\nWrote more code.\n",
    [`${ROOT}\\Projects\\Roadmap.md`]: "# Roadmap\n\n1. Ship\n2. Iterate\n",
    [`${ROOT}\\notes.txt`]: "plain text note\nsecond line\n",
};

function load(): Disk {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw) as Disk;
    } catch { /* fall through to seed */ }
    return seed();
}
function seed(): Disk {
    const d: Disk = {};
    const now = Date.now();
    for (const [p, c] of Object.entries(SEED)) d[p] = { content: c, modified: now - 60_000 };
    return d;
}
let disk: Disk = load();
function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(disk)); } catch { /* quota */ }
}

const norm = (p: string) => p.replace(/\//g, "\\");
const baseName = (p: string) => norm(p).split("\\").pop() ?? p;
const dirName = (p: string) => { const n = norm(p); return n.slice(0, n.lastIndexOf("\\")); };
const isNote = (p: string) => /\.(md|markdown|txt|text)$/i.test(p);
const find = (p: string) => {
    const k = Object.keys(disk).find((x) => x.toLowerCase() === norm(p).toLowerCase());
    return k;
};
function dirs(): Set<string> {
    const s = new Set<string>([ROOT]);
    for (const p of Object.keys(disk)) {
        let d = dirName(p);
        while (d.length >= ROOT.length) { s.add(d); d = dirName(d); }
    }
    for (const d of extraDirs) s.add(d);
    return s;
}
const extraDirs = new Set<string>();

function err(msg: string): never {
    throw msg;
}

const callbacks = new Map<number, (v: unknown) => void>();
let nextCb = 1;
const listeners = new Map<string, Set<number>>();

interface Hooks {
    nextOpen: string[] | string | null;
    nextSave: string | null;
    nextAsk: boolean | null;
    latencyMs: number;
    log: { cmd: string; args: unknown }[];
    write(path: string, text: string): void;
    read(path: string): string | undefined;
    emit(event: string, payload: unknown): void;
    reset(): void;
}

function searchIn(query: string, caseSensitive: boolean, wholeWord: boolean, directory: string) {
    const out: { path: string; name: string; matches: { line: number; text: string }[] }[] = [];
    const q = caseSensitive ? query : query.toLowerCase();
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = wholeWord ? new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}($|[^\\p{L}\\p{N}_])`, "u") : null;
    for (const [p, f] of Object.entries(disk)) {
        if (!norm(p).toLowerCase().startsWith(norm(directory).toLowerCase()) || !isNote(p)) continue;
        const matches: { line: number; text: string }[] = [];
        f.content.split("\n").forEach((line, i) => {
            const hay = caseSensitive ? line : line.toLowerCase();
            if (re ? re.test(hay) : hay.includes(q)) matches.push({ line: i + 1, text: line.trim() });
        });
        if (matches.length) out.push({ path: p, name: baseName(p), matches });
    }
    return out;
}

async function handle(cmd: string, a: Record<string, any>): Promise<unknown> {
    switch (cmd) {
        case "read_file": {
            const k = find(a.path) ?? err(`File not found: ${a.path}`);
            const f = disk[k];
            return { path: k, name: baseName(k), content: f.content, size: f.content.length, line_count: f.content.split("\n").length, modified: f.modified };
        }
        case "save_file": {
            const k = find(a.path) ?? norm(a.path);
            const modified = Math.max(Date.now(), (disk[k]?.modified ?? 0) + 1);
            disk[k] = { content: a.content, modified };
            persist();
            return modified;
        }
        case "get_file_info": {
            const k = find(a.path);
            if (!k) {
                if (dirs().has(norm(a.path))) return { path: norm(a.path), name: baseName(a.path), size: 0, modified: 0 };
                err(`File not found: ${a.path}`);
            }
            return { path: k, name: baseName(k), size: disk[k].content.length, modified: disk[k].modified };
        }
        case "list_directory_files": {
            const d = norm(a.directory);
            if (!dirs().has(d)) err(`File not found: ${d}`);
            const entries: { name: string; path: string; is_dir: boolean }[] = [];
            for (const sub of dirs()) if (dirName(sub) === d && sub !== d) entries.push({ name: baseName(sub), path: sub, is_dir: true });
            for (const p of Object.keys(disk)) if (dirName(p) === d && isNote(p)) entries.push({ name: baseName(p), path: p, is_dir: false });
            return entries.sort((x, y) => Number(y.is_dir) - Number(x.is_dir) || x.name.toLowerCase().localeCompare(y.name.toLowerCase()));
        }
        case "create_folder": {
            const p = `${norm(a.parent)}\\${a.name}`;
            extraDirs.add(p);
            return p;
        }
        case "rename_path": {
            const k = find(a.path) ?? err("Not found");
            const np = `${dirName(k)}\\${a.newName}`;
            if (find(np)) err("A file with that name already exists");
            disk[np] = disk[k];
            delete disk[k];
            persist();
            return np;
        }
        case "trash_path": {
            const k = find(a.path) ?? err("Not found");
            const np = `${dirName(k)}\\.trash\\${baseName(k)}`;
            disk[np] = disk[k];
            delete disk[k];
            persist();
            return np;
        }
        case "search_files":
            return searchIn(a.query, !!a.caseSensitive, !!a.wholeWord, a.directory);
        case "find_backlinks": {
            const stem = baseName(a.targetFile).replace(/\.(md|markdown)$/i, "");
            return searchIn(`[[${stem}`, false, false, a.directory).filter((r) => norm(r.path) !== norm(a.targetFile));
        }
        case "get_cli_file":
        case "get_incoming_file":
            return null;
        case "get_ai_key":
            return "";
        case "set_ai_key":
            return null;
        case "read_image_file":
            err("Images are not available in the fake backend");
            break;
        case "write_export_file":
            return null;
        // ---- plugins ----
        case "plugin:event|listen": {
            const set = listeners.get(a.event) ?? new Set<number>();
            set.add(a.handler);
            listeners.set(a.event, set);
            return a.handler;
        }
        case "plugin:event|unlisten":
            listeners.get(a.event)?.delete(a.eventId);
            return null;
        case "plugin:event|emit":
        case "plugin:event|emit_to":
            return null;
        case "plugin:dialog|open": {
            const next = hooks.nextOpen;
            hooks.nextOpen = null;
            if (next != null) return next;
            const typed = window.prompt("[fakefs] Open which file?", `${ROOT}\\Welcome.md`);
            if (!typed) return null;
            return a.options?.multiple ? [typed] : typed;
        }
        case "plugin:dialog|save": {
            const next = hooks.nextSave;
            hooks.nextSave = null;
            if (next != null) return next;
            const typed = window.prompt("[fakefs] Save as?", `${ROOT}\\${a.options?.defaultPath ?? "Untitled.md"}`);
            return typed || null;
        }
        case "plugin:dialog|message": {
            const next = hooks.nextAsk;
            hooks.nextAsk = null;
            const yes = next ?? window.confirm(`[fakefs] ${a.message}`);
            const b = a.buttons;
            if (b && typeof b === "object" && "OkCancelCustom" in b) return yes ? b.OkCancelCustom[0] : b.OkCancelCustom[1];
            if (b === "OkCancel") return yes ? "Ok" : "Cancel";
            return yes ? "Yes" : "No";
        }
        default:
            if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) {
                if (cmd.endsWith("is_fullscreen") || cmd.endsWith("is_maximized")) return false;
                return null;
            }
            if (cmd.startsWith("plugin:updater|")) return null;
            if (cmd.startsWith("plugin:opener|")) return null;
            err(`[fakefs] unhandled command ${cmd}`);
    }
}

const hooks: Hooks = {
    nextOpen: null,
    nextSave: null,
    nextAsk: null,
    latencyMs: 5,
    log: [],
    write(path, text) {
        const k = find(path) ?? norm(path);
        disk[k] = { content: text, modified: Math.max(Date.now(), (disk[k]?.modified ?? 0) + 1) };
        persist();
    },
    read(path) {
        const k = find(path);
        return k ? disk[k].content : undefined;
    },
    emit(event, payload) {
        for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
    },
    reset() {
        disk = seed();
        persist();
    },
};

export function installFakeTauri(): void {
    const w = window as unknown as Record<string, unknown>;
    // `&raf=1`: an agent-driven browser pane that isn't being painted never
    // runs requestAnimationFrame callbacks, which stalls every rAF-deferred
    // flow (tab-switch caret restore, goto-line, CodeMirror measuring). A
    // timer-backed rAF keeps those flows observable while testing.
    if (/[?&]raf=1(&|$)/.test(window.location.search)) {
        window.requestAnimationFrame = (cb: FrameRequestCallback) =>
            window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
        window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
    }
    w.__fakefs = hooks;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener(event: string, id: number) { listeners.get(event)?.delete(id); },
    };
    w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback(cb: (v: unknown) => void, once = false) {
            const id = nextCb++;
            callbacks.set(id, (v) => { if (once) callbacks.delete(id); cb(v); });
            return id;
        },
        unregisterCallback(id: number) { callbacks.delete(id); },
        convertFileSrc(p: string) { return p; },
        async invoke(cmd: string, args: Record<string, unknown> = {}) {
            hooks.log.push({ cmd, args });
            if (hooks.log.length > 200) hooks.log.shift();
            await new Promise((r) => setTimeout(r, hooks.latencyMs));
            return handle(cmd, args as Record<string, any>);
        },
    };
    // Small driver for agent/browser sessions: `__t.open(path)`, `__t.view()`
    // (the live CodeMirror view), `__t.pos()`, `__t.tabs()`, `__t.mode("code")`.
    w.__t = {
        sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
        view: () => (document.querySelector(".cm-content") as unknown as { cmTile?: { view: unknown } } | null)?.cmTile?.view,
        async open(path: string) {
            hooks.nextOpen = path;
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true }));
            await new Promise((r) => setTimeout(r, 400));
        },
        tabs: () =>
            [...document.querySelectorAll("[role=tab]")].map(
                (t) => (t.getAttribute("aria-selected") === "true" ? "*" : "") + t.getAttribute("aria-label"),
            ),
        status: () => (document.querySelector("footer") as HTMLElement | null)?.innerText.replace(/\n/g, " | "),
        pos() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const v = (w.__t as any).view();
            if (!v) return null;
            const h = v.state.selection.main.head;
            const l = v.state.doc.lineAt(h);
            return { line: l.number, col: h - l.from + 1, scroll: Math.round(v.scrollDOM.scrollTop) };
        },
        mode(m: "code" | "preview" | "split") {
            const label = { code: "Code editor", preview: "Reader mode", split: "Split view" }[m];
            (document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null)?.click();
        },
    };
    console.info("[fakefs] fake Tauri backend installed — disk root", ROOT);
}
