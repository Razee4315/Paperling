import { useRef, useEffect, useCallback, useMemo, useState, useTransition, memo, createContext, useContext } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFlexibleMarkers from "remark-flexible-markers";
import remarkSupersub from "../utils/remarkSupersub";
import { remarkDefinitionList, defListHastHandlers } from "remark-definition-list";
import remarkCustomHeadingId from "../utils/remarkCustomHeadingId";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterValue } from "../utils/frontmatter";
import { IS_MOBILE } from "../utils/platform";
import type { Scroller } from "../utils/scrollSync";
import { MermaidBlock, isMermaidLanguage } from "./MermaidBlock";

// Detect KaTeX-style math so we only load the heavy katex bundle when needed.
// $$...$$ for block math, $...$ for inline math (not preceded/followed by digit
// to avoid false positives like "$5 and $10"). Bare \ce{...} / \pu{...} also
// matches, but only to warm the bundle while someone is mid-typing a chemistry
// block: RENDERING still requires math delimiters ($...$ or $$...$$), because
// nothing converts a bare \ce{} into a math node (#111).
const MATH_DETECTION_REGEX = /(\$\$[\s\S]+?\$\$)|((?:^|[^\d$])\$[^\s$][^\n$]*?[^\s$]\$(?!\d))|(\\ce\{)|(\\pu\{)/m;
const hasMath = (s: string): boolean => MATH_DETECTION_REGEX.test(s);

// rehype-highlight config. `detect: false` is the library default — pinned here
// explicitly so a future default change can't silently turn full-language
// auto-detection back on. Only fenced blocks with an explicit language are
// highlighted; untagged blocks render plain. Unknown language tags are ignored
// gracefully by the plugin (no throw). PREVIEW-02.
const HIGHLIGHT_OPTIONS = { detect: false } as const;

// GFM's strikethrough tokenizer claims single tildes by default (micromark's
// `singleTilde` defaults to true), which would consume `~sub~` at PARSE time —
// the supersub plugin only transforms plain text nodes, so it would never see
// the tildes. Turning singleTilde off keeps `~~strike~~` working (GitHub's
// actual syntax) while leaving `~x~` in the text for the subscript plugin.
// SYNTAX-01.
const GFM_OPTIONS = { singleTilde: false } as const;

// remark-definition-list only parses `Term / : definition` into mdast nodes; it
// ships the matching mdast->hast handlers separately, and they must be handed to
// remark-rehype or the defList nodes never become <dl>/<dt>/<dd>. react-markdown
// merges this as `{...remarkRehypeOptions, ...{allowDangerousHtml: true}}` — its
// own defaults are spread LAST, so allowDangerousHtml can't be clobbered from
// here, and remark-rehype's `clobberPrefix` default ("user-content-", which the
// footnote ids rely on) is untouched because neither side sets it. SYNTAX-01.
const REMARK_REHYPE_OPTIONS = { handlers: defListHastHandlers } as const;

// Inline/raw HTML support (GitHub-style). react-markdown ignores raw HTML by
// default; rehype-raw reparses it into real nodes, and rehype-sanitize then
// strips anything dangerous. Order matters: raw FIRST (it produces the unsafe
// tree), sanitize immediately AFTER (the rule is "sanitize after the last
// unsafe thing"), and the trusted markup generators (KaTeX, highlight.js) and
// the source-line stamper run LAST so sanitize can't strip their output. A
// booby-trapped downloaded .md is a real vector in a desktop app that exposes
// a Tauri IPC bridge, so sanitizing is not optional even for "local" files.
//
// The schema is GitHub's defaultSchema plus two narrow additions:
//  - `math`/`math-inline`/`math-display` classes on span/div, so remark-math's
//    markers survive sanitize and rehype-katex (which runs after) can find them;
//  - the `wikilink:` href protocol, so our internal links aren't stripped.
const SANITIZE_SCHEMA = {
    ...defaultSchema,
    // remark-rehype already prefixes every footnote id AND its matching href
    // with `user-content-`; sanitize's default clobber pass would prefix the
    // id a SECOND time (ids are on its clobber list, fragment hrefs are not),
    // so footnote refs and back-arrows pointed at ids that don't exist — in
    // the app and in every export. Markdown-generated ids stay clobber-safe
    // via the remark prefix. The cost: ids on raw HTML are no longer
    // rewritten; acceptable since the schema allows none of the elements
    // DOM-clobbering needs (form/iframe/object/embed) and the bundled app
    // never reads bare window globals an id could shadow.
    clobberPrefix: "",
    // `mark` is not in GitHub's default allowlist; the ==highlight== syntax
    // (remark-flexible-markers) emits it, so it must survive sanitize. `sup`,
    // `sub`, `dl`, `dt` and `dd` are already in defaultSchema.tagNames. SYNTAX-01.
    tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
    attributes: {
        ...defaultSchema.attributes,
        span: [...(defaultSchema.attributes?.span ?? []), ["className", "math", "math-inline", "math-display"]],
        div: [...(defaultSchema.attributes?.div ?? []), ["className", "math", "math-inline", "math-display"]],
    },
    protocols: {
        ...defaultSchema.protocols,
        href: [...(defaultSchema.protocols?.href ?? []), "wikilink"],
    },
} as typeof defaultSchema;

// react-markdown's default urlTransform drops any href whose scheme isn't in a
// small safe list — which silently kills our internal `wikilink:` links (the
// click handler keys off that exact scheme). Pass those through; defer
// everything else to the default, which still blocks javascript:, etc.
const mdUrlTransform = (url: string): string =>
    url.startsWith("wikilink:") ? url : defaultUrlTransform(url);

// rehype plugin: stamp each top-level rendered block with the source line it came
// from (data-source-line). Lets the preview report the ACCURATE top-visible line
// instead of the `fraction * lineCount` approximation, which is wrong whenever
// blocks have non-uniform heights (headings, images, code, tables). PREVIEW-05.
interface HastBlock { type: string; position?: { start?: { line?: number } }; properties?: Record<string, unknown> }
function rehypeSourceLine() {
    return (tree: { children?: HastBlock[] }) => {
        if (!tree.children) return;
        for (const node of tree.children) {
            const line = node.position?.start?.line;
            if (node.type === "element" && line) {
                node.properties = node.properties || {};
                node.properties.dataSourceLine = line;
            }
        }
    };
}

// rehype plugin: give every heading a unique, GitHub-style slug id. The first
// "## Setup" becomes #setup, the second #setup-1, and so on. Without this two
// identical headings share an id, so in-document `#anchor` links and the
// heading copy-link both jump to the first one. Runs on the hast tree (no React
// render side-effects) and AFTER rehypeSanitize so the id we add isn't clobbered
// or prefixed by the sanitizer. NAV-02.
interface HastTextNode { type: string; tagName?: string; value?: string; children?: HastTextNode[]; properties?: Record<string, unknown> }
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
function hastText(node: HastTextNode): string {
    if (node.type === "text") return node.value ?? "";
    return (node.children ?? []).map(hastText).join("");
}
function rehypeHeadingIds() {
    return (tree: { children?: HastTextNode[] }) => {
        const seen = new Map<string, number>();
        const walk = (nodes?: HastTextNode[]) => {
            if (!nodes) return;
            for (const node of nodes) {
                if (node.type === "element" && node.tagName && HEADING_TAGS.has(node.tagName)) {
                    node.properties = node.properties || {};
                    // A `{#custom-id}` id (remarkCustomHeadingId -> hProperties)
                    // has already survived sanitize (clobberPrefix "") — respect
                    // it, reserve it so a later auto-slug can't collide, and
                    // suffix repeats so the DOM never carries duplicate ids.
                    // Slugs stay the fallback. SYNTAX-01.
                    const existing = node.properties.id;
                    if (typeof existing === "string" && existing !== "") {
                        const count = seen.get(existing) ?? 0;
                        seen.set(existing, count + 1);
                        if (count > 0) node.properties.id = `${existing}-${count}`;
                    } else {
                        const base = slugify(hastText(node)) || "section";
                        const count = seen.get(base) ?? 0;
                        seen.set(base, count + 1);
                        node.properties.id = count === 0 ? base : `${base}-${count}`;
                    }
                }
                walk(node.children);
            }
        };
        walk(tree.children);
    };
}

// Nearest source line at the top of the scroll container, via the data-source-line
// anchors above. Binary search over the blocks (rect.top is monotonic in document
// order) so it's O(log n) getBoundingClientRect calls per scroll frame. PREVIEW-05.
function topSourceLine(container: HTMLElement): number | null {
    const blocks = container.querySelectorAll<HTMLElement>("[data-source-line]");
    if (blocks.length === 0) return null;
    // Sample a little below the top edge so a block scrolled to the very top
    // (e.g. via a TOC click that lands it there) is reliably counted as current.
    const top = container.getBoundingClientRect().top + 14;
    let lo = 0, hi = blocks.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (blocks[mid].getBoundingClientRect().top <= top) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return Number(blocks[ans].getAttribute("data-source-line")) || 1;
}

type PluginPair = { remark: unknown; rehype: unknown };
let mathPluginsCache: PluginPair | null = null;
let mathLoadPromise: Promise<PluginPair> | null = null;

const loadMathPlugins = (): Promise<PluginPair> => {
    if (mathPluginsCache) return Promise.resolve(mathPluginsCache);
    if (mathLoadPromise) return mathLoadPromise;
    // Load mhchem alongside KaTeX so chemistry notation like
    //   $\ce{2 Fe^x_{Fe} + O^x_{O} -> 2 Fe'_{Fe} + V_{O}^{**} + 1/2 O2 ^}$
    // renders properly in standard book-style typography. mhchem patches
    // KaTeX's macro table on import, so it must load before the first render.
    mathLoadPromise = Promise.all([
        import("remark-math"),
        import("rehype-katex"),
        import("katex/dist/katex.min.css"),
        import("katex/dist/contrib/mhchem.mjs"),
    ]).then(([rm, rk]) => {
        mathPluginsCache = { remark: rm.default, rehype: rk.default };
        return mathPluginsCache;
    });
    return mathLoadPromise;
};

interface MarkdownPreviewProps {
    content: string;
    fileName: string;
    fileSize: number;
    onEditClick: () => void;
    onLineChange?: (line: number) => void;
    filePath?: string | null;
    markdownBodyRef?: React.RefObject<HTMLDivElement | null>;
    onContentChange?: (newContent: string) => void;
    onScrollFraction?: (fraction: number) => void;
    registerScroller?: (scroller: Scroller | null) => void;
    onWikilinkClick?: (target: string) => void;
    /** Open a relative `[text](note.md)` link in-app instead of externally. */
    onNavigateRelative?: (href: string) => void;
}

/** Slugify heading text into a stable, URL-safe id (GitHub-style). */
const slugify = (text: string): string =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

/** Extract the plain-text label from a React node tree (for slug + anchor link). */
function nodeText(node: React.ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(nodeText).join("");
    if (node && typeof node === "object" && "props" in node) {
        // @ts-expect-error - children may exist on element
        return nodeText(node.props?.children);
    }
    return "";
}

// MIME type lookup for image extensions
const IMAGE_MIME_TYPES: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp'
};

// Module-level shared cache for local image blobs. Without this, a doc that
// references the same image 50 times reads the file 50 times and creates 50
// independent ObjectURLs. With it, repeat references hit memory.
//
// LRU eviction at CACHE_CAP entries: the Map preserves insertion order, so we
// re-insert on hit (move to end) and evict from the front when full. Evicted
// URLs are revoked so the image data can be GC'd.
const LOCAL_IMAGE_CACHE = new Map<string, string>();
const LOCAL_IMAGE_CACHE_CAP = 100;

async function getCachedLocalImageUrl(baseDir: string, relPath: string, mimeType: string): Promise<string> {
    const cacheKey = `${baseDir}\u0000${relPath}`;
    const hit = LOCAL_IMAGE_CACHE.get(cacheKey);
    if (hit !== undefined) {
        // Move-to-end so this entry is now most-recently-used.
        LOCAL_IMAGE_CACHE.delete(cacheKey);
        LOCAL_IMAGE_CACHE.set(cacheKey, hit);
        return hit;
    }
    // Read via the validated Rust command (containment + symlink-safe) instead of
    // the broad plugin-fs readFile. Returns an ArrayBuffer (tauri::ipc::Response).
    const buf = await invoke<ArrayBuffer>("read_image_file", { baseDir, relPath });
    const blob = new Blob([buf], { type: mimeType });
    const url = URL.createObjectURL(blob);
    LOCAL_IMAGE_CACHE.set(cacheKey, url);
    if (LOCAL_IMAGE_CACHE.size > LOCAL_IMAGE_CACHE_CAP) {
        const oldestKey = LOCAL_IMAGE_CACHE.keys().next().value;
        if (oldestKey !== undefined) {
            const oldUrl = LOCAL_IMAGE_CACHE.get(oldestKey);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            LOCAL_IMAGE_CACHE.delete(oldestKey);
        }
    }
    return url;
}

/**
 * Reject paths that would escape the markdown file's directory or name an
 * absolute location. The capabilities allow `**` reads, so we have to enforce
 * the boundary in code: a malicious .md must not be able to use
 * `![pwn](../../../etc/passwd)` to peek at arbitrary files.
 */
function isUnsafeRelativePath(p: string): boolean {
    if (!p) return true;
    if (/\0/.test(p)) return true;
    // Absolute paths: leading slash, leading backslash, or drive letter.
    if (/^([a-zA-Z]:|\/|\\)/.test(p)) return true;
    // Any segment that is exactly `..` (handles foo/../etc, ../etc, etc.).
    const segments = p.split(/[/\\]+/);
    return segments.some((seg) => seg === "..");
}

// Component to handle local image loading
function LocalImage({ src, alt, baseDir, ...props }: { src: string; alt: string; baseDir: string | null } & React.ImgHTMLAttributes<HTMLImageElement>) {
    const [imageSrc, setImageSrc] = useState<string>('');
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!baseDir || !src) return;

        // External URLs and data: URIs go straight to the <img>.
        if (src.includes('://') || src.startsWith('data:')) {
            setImageSrc(src);
            setError(false);
            return;
        }

        // Strip a leading `./` then validate. Anything with a `..` segment, an
        // absolute prefix, or a drive letter is rejected — see
        // isUnsafeRelativePath above.
        const cleanPath = src.startsWith('./') ? src.slice(2) : src;
        if (isUnsafeRelativePath(cleanPath)) {
            setError(true);
            return;
        }

        const ext = cleanPath.split('.').pop()?.toLowerCase() || 'png';
        const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';

        let cancelled = false;
        // baseDir + cleanPath are joined + validated in the Rust read_image_file
        // command; we no longer build an absolute path on the JS side.
        getCachedLocalImageUrl(baseDir, cleanPath, mimeType)
            .then((url) => {
                if (!cancelled) {
                    setImageSrc(url);
                    setError(false);
                }
            })
            .catch((err) => {
                console.error('Failed to load image:', err);
                if (!cancelled) setError(true);
            });

        return () => {
            cancelled = true;
            // Don't revoke the URL — the cache owns it. Cache eviction handles
            // revocation when the entry is pushed out by LRU pressure.
        };
    }, [src, baseDir]);

    if (error) {
        return (
            <div className="my-4 p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm">
                Failed to load image: {src}
            </div>
        );
    }

    if (!imageSrc) {
        return (
            <div className="my-4 p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-secondary)] animate-pulse">
                <div className="h-32 bg-[var(--bg-tertiary)] rounded"></div>
            </div>
        );
    }

    return (
        <img
            src={imageSrc}
            alt={alt || 'image'}
            {...props}
            loading="lazy"
            className="max-w-full h-auto rounded-lg my-4 cursor-zoom-in transition-transform hover:scale-[1.01]"
            onClick={() => {
                const evt = new CustomEvent("paperling:zoom", { detail: { src: imageSrc, alt } });
                window.dispatchEvent(evt);
            }}
        />
    );
}

/** Pull className + raw text out of a react-markdown <pre><code>...</code></pre> child. */
function extractCodeChild(children: React.ReactNode): { className?: string; text: string } | null {
    // <pre>'s child is the <code> element React node
    if (!children || typeof children !== "object") return null;
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) {
        if (child && typeof child === "object" && "props" in child) {
            const props = (child as { props: { className?: string; children?: React.ReactNode } }).props;
            return {
                className: props.className,
                text: nodeText(props.children),
            };
        }
    }
    return null;
}

/** Code block with a copy-to-clipboard button — also intercepts mermaid blocks. */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
    const ref = useRef<HTMLPreElement>(null);
    const [copied, setCopied] = useState(false);

    const codeInfo = extractCodeChild(children);
    if (codeInfo && isMermaidLanguage(codeInfo.className)) {
        return <MermaidBlock code={codeInfo.text} />;
    }

    const handleCopy = async () => {
        const text = ref.current?.innerText ?? "";
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            // ignore — clipboard may be unavailable in some webviews
        }
    };

    return (
        <div className="relative group">
            <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy code"
                className={`absolute top-2 right-2 z-10 px-2 py-1 text-[11px] rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-opacity ${
                    // Hover-only = unreachable on touch; keep it visible there.
                    IS_MOBILE ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
            >
                {copied ? "Copied!" : "Copy"}
            </button>
            <pre ref={ref} {...rest}>{children}</pre>
        </div>
    );
}

/** Render YAML frontmatter as a collapsible, editable metadata card. */
function FrontmatterCard({
    data,
    editable,
    onChange,
}: {
    data: Record<string, FrontmatterValue>;
    editable: boolean;
    onChange?: (next: Record<string, FrontmatterValue>) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const entries = Object.entries(data);
    if (entries.length === 0) return null;

    const updateKey = (k: string, v: FrontmatterValue) => onChange?.({ ...data, [k]: v });

    const renderValue = (k: string, v: FrontmatterValue) => {
        if (Array.isArray(v)) {
            return (
                <div className="flex flex-wrap gap-1 items-center">
                    {v.map((item, i) => (
                        <span key={i} className="px-2 py-0.5 text-xs bg-[var(--bg-hover)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center gap-1">
                            {item}
                            {editable && (
                                <button
                                    type="button"
                                    onClick={() => updateKey(k, v.filter((_, idx) => idx !== i))}
                                    aria-label={`Remove ${item}`}
                                    className="opacity-50 hover:opacity-100"
                                >
                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                </button>
                            )}
                        </span>
                    ))}
                    {editable && (
                        <input
                            type="text"
                            placeholder="+ add"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    const val = e.currentTarget.value.trim();
                                    if (val) {
                                        updateKey(k, [...v, val]);
                                        e.currentTarget.value = "";
                                    }
                                }
                            }}
                            className="px-1.5 py-0.5 text-xs bg-transparent border border-dashed border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] w-20"
                        />
                    )}
                </div>
            );
        }
        if (typeof v === "boolean") {
            if (editable) {
                return (
                    <button
                        type="button"
                        onClick={() => updateKey(k, !v)}
                        className={`relative inline-block w-9 h-5 rounded-full transition-colors ${v ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
                        aria-pressed={v}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${v ? "translate-x-4" : ""}`} />
                    </button>
                );
            }
            return <span className="text-xs font-mono">{v ? "true" : "false"}</span>;
        }
        if (editable) {
            return (
                <input
                    type={typeof v === "number" ? "number" : "text"}
                    defaultValue={String(v)}
                    onBlur={(e) => {
                        const raw = e.target.value;
                        const next: FrontmatterValue = typeof v === "number" ? Number(raw) : raw;
                        if (next !== v) updateKey(k, next);
                    }}
                    className="w-full px-2 py-0.5 text-sm bg-transparent border-b border-transparent hover:border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text-primary)]"
                />
            );
        }
        return <span className="text-sm">{String(v)}</span>;
    };

    return (
        <div className="mb-6 border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden bg-[var(--bg-secondary)]">
            <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider hover:bg-[var(--bg-hover)] transition-colors"
                aria-expanded={!collapsed}
            >
                <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    Properties
                </span>
                <span className="material-symbols-outlined text-[18px]">
                    {collapsed ? "expand_more" : "expand_less"}
                </span>
            </button>
            {!collapsed && (
                <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm items-center">
                        {entries.map(([k, v]) => (
                            <div key={k} className="contents">
                                <dt className="font-mono text-xs text-[var(--text-muted)]">{k}</dt>
                                <dd className="text-[var(--text-primary)]">{renderValue(k, v)}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </div>
    );
}

/** Source line (body-relative, 1-based) of the enclosing list item. Set by the
 *  custom `li` renderer; lets a task checkbox identify which source line it
 *  represents without render-order counters, which mis-address tasks when
 *  StrictMode/concurrent React re-runs renderers out of lockstep with the
 *  component body (PREVIEW-07). */
const TaskLineContext = createContext<number | null>(null);

/** Interactive task checkbox — local optimistic state, parent writes to source. */
function InteractiveTaskCheckbox({ initialChecked, onToggle }: { initialChecked: boolean; onToggle: (line: number, checked: boolean) => void }) {
    const line = useContext(TaskLineContext);
    const [checked, setChecked] = useState(initialChecked);
    useEffect(() => setChecked(initialChecked), [initialChecked]);
    return (
        <input
            type="checkbox"
            checked={checked}
            // Without a source line we can't write back; stay inert rather than
            // flipping a checkbox the document won't remember.
            disabled={line == null}
            onChange={(e) => {
                if (line == null) return;
                const next = e.target.checked;
                setChecked(next);
                onToggle(line, next);
            }}
            className="mr-2 cursor-pointer accent-[var(--accent)]"
        />
    );
}

/** Heading with click-to-copy permalink (GitHub-style). */
function HeadingWithAnchor(
    props: { level: 1 | 2 | 3 | 4 | 5 | 6 } & React.HTMLAttributes<HTMLHeadingElement>
) {
    const { level, children, className, id: assignedId, ...rest } = props;
    const text = nodeText(children);
    // rehypeHeadingIds assigns a unique, deduped id on the hast node; prefer it
    // so the element id and the copy-link below always agree. Fall back to a raw
    // slug only if the plugin somehow didn't run. NAV-02.
    const id = assignedId ?? slugify(text);
    const [copied, setCopied] = useState(false);
    const handleClick = async () => {
        const el = document.getElementById(id);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        // Also copy a link to this section. Scrolling a heading to itself is a
        // ~0px move when it's already at the top of the viewport, so without this
        // the click looks like it "does nothing"; the clipboard copy + icon swap
        // give the action visible feedback. Mirrors CodeBlock's copy pattern.
        try {
            await navigator.clipboard.writeText(`#${id}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            // clipboard may be unavailable in some webviews — scroll still works
        }
    };
    const inner = (
        <>
            <span>{children}</span>
            <button
                type="button"
                onClick={handleClick}
                aria-label={`Copy link to "${text}"`}
                title={copied ? "Link copied" : "Copy link to this section"}
                className={`text-[var(--text-muted)] hover:text-[var(--accent)] transition-opacity ${
                    IS_MOBILE ? "opacity-100" : "opacity-0 group-hover/heading:opacity-60 hover:!opacity-100"
                }`}
                tabIndex={-1}
            >
                <span className="material-symbols-outlined" style={{ fontSize: "0.7em", verticalAlign: "middle" }}>{copied ? "check" : "link"}</span>
            </button>
        </>
    );
    const sharedProps = {
        id,
        ...rest,
        className: `${className ?? ""} group/heading flex items-baseline gap-2`,
    };
    switch (level) {
        case 1: return <h1 {...sharedProps}>{inner}</h1>;
        case 2: return <h2 {...sharedProps}>{inner}</h2>;
        case 3: return <h3 {...sharedProps}>{inner}</h3>;
        case 4: return <h4 {...sharedProps}>{inner}</h4>;
        case 5: return <h5 {...sharedProps}>{inner}</h5>;
        case 6: return <h6 {...sharedProps}>{inner}</h6>;
    }
}

// Stable, stateless renderers hoisted to module scope so their identity never
// changes across renders — react-markdown then won't remount these node types
// when the components map is rebuilt (e.g. on file change). PREVIEW-06.
const PreRenderer = (props: React.HTMLAttributes<HTMLPreElement>) => <CodeBlock {...props} />;
const H1Renderer = (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={1} {...props} />;
const H2Renderer = (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={2} {...props} />;
const H3Renderer = (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={3} {...props} />;
const H4Renderer = (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={4} {...props} />;
const H5Renderer = (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={5} {...props} />;
const H6Renderer = (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={6} {...props} />;
// Wide tables scroll left/right INSIDE their own box (like code blocks do)
// instead of stretching the whole document — a table wider than the column
// used to make the entire preview pannable sideways, so a vertical reading
// scroll kept drifting into empty space. Module-scope for renderer identity
// stability (PREVIEW-06).
const TableRenderer = ({ node, ...props }: React.HTMLAttributes<HTMLTableElement> & { node?: unknown }) => (
    <div className="table-scroll">
        <table {...props} />
    </div>
);

function MarkdownPreviewImpl({
    content,
    onLineChange,
    filePath,
    markdownBodyRef,
    onContentChange,
    onScrollFraction,
    registerScroller,
    onWikilinkClick,
    onNavigateRelative,
}: MarkdownPreviewProps) {
    const mainRef = useRef<HTMLElement>(null);
    const [zoomImage, setZoomImage] = useState<{ src: string; alt: string } | null>(null);

    // lineCount is derived here (instead of being passed as a prop) so the
    // preview's split happens once, against the same `content` we render.
    // App used to compute this from live content and pass it down, which
    // double-scanned the document on every keystroke and reported the wrong
    // count for the (debounced) snapshot we're actually rendering.
    const lineCount = useMemo(() => content.split("\n").length, [content]);

    // Latest content via ref so handleTaskToggle (and therefore the components
    // map) stays reference-stable across keystrokes — without this the map is
    // rebuilt every edit, forcing react-markdown to treat every renderer as new
    // and defeating the deferred render below. PREVIEW-06.
    const contentRef = useRef(content);
    contentRef.current = content;

    // Listen for zoom requests from LocalImage clicks
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.src) setZoomImage({ src: detail.src, alt: detail.alt || "" });
        };
        window.addEventListener("paperling:zoom", handler);
        return () => window.removeEventListener("paperling:zoom", handler);
    }, []);

    // Esc closes lightbox
    useEffect(() => {
        if (!zoomImage) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setZoomImage(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [zoomImage]);

    // Get the directory containing the markdown file
    const baseDir = useMemo(() => {
        if (!filePath) return null;
        const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        return lastSep > 0 ? filePath.slice(0, lastSep) : null;
    }, [filePath]);

    // Toggle the task checkbox that starts on the given body-relative source
    // line — write back to the source markdown. Line-addressed via the AST
    // node position rather than a render-order counter: StrictMode/concurrent
    // React re-runs the components map an unpredictable number of times, so a
    // counter shared across render passes mis-addresses tasks (clicking task N
    // toggled task N+1). A line number identifies the task regardless of how
    // many times anything rendered.
    const handleTaskToggle = useCallback((bodyLine: number, checked: boolean) => {
        if (!onContentChange) return;
        const lines = contentRef.current.split("\n");
        // node positions are body-relative (frontmatter is stripped before
        // react-markdown sees the text) and 1-based.
        const i = bodyLine - 1 + fmOffsetRef.current;
        const taskRe = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)/;
        if (i < 0 || i >= lines.length || !taskRe.test(lines[i])) return;
        lines[i] = lines[i].replace(taskRe, `$1${checked ? "x" : " "}$3`);
        onContentChange(lines.join("\n"));
    }, [onContentChange]);

    const components = useMemo(() => ({
        img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
            <LocalImage src={src || ''} alt={alt || 'image'} baseDir={baseDir} {...props} />
        ),
        a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
            // Wikilink: open same-folder file via callback
            if (href && href.startsWith("wikilink:")) {
                const target = decodeURIComponent(href.slice("wikilink:".length));
                return (
                    <a
                        {...rest}
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            onWikilinkClick?.(target);
                        }}
                        className="text-[var(--syntax-link)] border-b border-dashed border-[var(--syntax-link)] hover:opacity-80"
                        title={`Wikilink: ${target}`}
                    >
                        {children}
                    </a>
                );
            }
            // In-page hash link (#section). The Tauri webview's URL doesn't
            // play well with native hash navigation, so we scroll explicitly.
            // Falls back to a fuzzy heading-text match when the slug doesn't
            // exactly match an existing id (different markdown anchor styles).
            if (href && href.startsWith("#")) {
                return (
                    <a
                        {...rest}
                        href={href}
                        onClick={(e) => {
                            e.preventDefault();
                            const id = decodeURIComponent(href.slice(1));
                            let el: HTMLElement | null = document.getElementById(id);
                            if (!el) {
                                // Fuzzy fallback: find a heading whose textContent
                                // slugifies to a string containing the requested id.
                                const needle = id.toLowerCase().replace(/-/g, " ").trim();
                                const headings = document.querySelectorAll<HTMLElement>(
                                    ".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6"
                                );
                                for (const h of headings) {
                                    const text = (h.textContent ?? "").toLowerCase();
                                    if (text.includes(needle) || needle.includes(text.trim())) {
                                        el = h;
                                        break;
                                    }
                                }
                            }
                            el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                    >
                        {children}
                    </a>
                );
            }
            // Relative links to local markdown files — `[x](note.md)`,
            // `[y](sub/note.md)`, `[z](../other.md)` — open in-app like wikilinks
            // instead of doing nothing. Only .md/.markdown (optionally with a
            // #fragment) are claimed so other relative links fall through. NAV-05.
            if (
                href &&
                onNavigateRelative &&
                !/^(https?:|mailto:|data:|wikilink:|#)/i.test(href) &&
                /\.(md|markdown)(#.*)?$/i.test(href)
            ) {
                const targetHref = href;
                return (
                    <a
                        {...rest}
                        // Keep the real relative href (not "#"): exports capture
                        // this DOM verbatim, so the link stays alive in exported
                        // HTML while in-app clicks still route through the
                        // callback below. EXPORT-04.
                        href={targetHref}
                        data-relative-md="true"
                        onClick={(e) => {
                            e.preventDefault();
                            onNavigateRelative(targetHref);
                        }}
                        // onClick never sees middle-click; with a real href the
                        // webview would otherwise get a new-window request for
                        // tauri.localhost/<file>.md.
                        onAuxClick={(e) => e.preventDefault()}
                    >
                        {children}
                    </a>
                );
            }
            // External http(s) and mailto links — route through the OS default
            // handler so the webview itself doesn't navigate away from the app.
            const isExternal = !!href && /^(https?:|mailto:)/i.test(href);
            return (
                <a
                    href={href}
                    {...rest}
                    {...(isExternal
                        ? { rel: "noopener noreferrer", target: "_blank" }
                        : {})}
                    onClick={(e) => {
                        if (!isExternal || !href) return;
                        e.preventDefault();
                        openUrl(href).catch((err) =>
                            console.error("Failed to open external URL:", err)
                        );
                    }}
                >
                    {children}
                </a>
            );
        },
        pre: PreRenderer,
        table: TableRenderer,
        h1: H1Renderer,
        h2: H2Renderer,
        h3: H3Renderer,
        h4: H4Renderer,
        h5: H5Renderer,
        h6: H6Renderer,
        // Every list item publishes its source line for task checkboxes below it.
        // The li node is a real source node and always carries a position; the
        // checkbox <input> is SYNTHESIZED by remark-gfm and carries none, so the
        // line must come from here (PREVIEW-07).
        li: ({ node, children, ...rest }: React.LiHTMLAttributes<HTMLLIElement> & { node?: { position?: { start?: { line?: number } } } }) => (
            <li {...rest}>
                <TaskLineContext.Provider value={node?.position?.start?.line ?? null}>
                    {children}
                </TaskLineContext.Provider>
            </li>
        ),
        // Interactive task checkbox: react-markdown + remarkGfm renders <input type="checkbox" disabled />.
        // The task is identified by its SOURCE LINE (via TaskLineContext from the
        // enclosing li), which is stable no matter how many render passes run.
        // Earlier designs used render-order counters; both the count-on-click and
        // the capture-on-render variants mis-addressed tasks once React re-ran the
        // renderers out of lockstep with the component body (PREVIEW-07).
        input: ({ type, checked, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => {
            if (type !== "checkbox") return <input type={type} checked={checked} {...rest} />;
            return <InteractiveTaskCheckbox initialChecked={!!checked} onToggle={handleTaskToggle} />;
        },
    }), [baseDir, handleTaskToggle, onWikilinkClick, onNavigateRelative]);

    // Parse YAML frontmatter once per content change. We render it as a
    // metadata card and pass the *body* (without the --- block) to react-markdown
    // so the raw YAML doesn't appear as a thematic break + heading.
    // Frontmatter is stripped from the rendered body, so data-source-line values
    // are body-relative. Add the stripped line count back so the line we report
    // is CONTENT-relative — matching the editor caret line and the TOC's heading
    // lines (both computed from the full document). Without this the active TOC
    // entry is off by the number of frontmatter lines.
    const fmOffsetRef = useRef(0);

    const { body: parsedBody, data: frontmatter, hasFrontmatter } = useMemo(
        () => parseFrontmatter(content),
        [content]
    );
    fmOffsetRef.current = hasFrontmatter
        ? Math.max(0, content.split("\n").length - parsedBody.split("\n").length)
        : 0;

    // Pre-process wikilinks: [[Foo]] and [[Foo|alias]] → [alias](wikilink:Foo).
    // We use a custom href scheme so the link click handler can detect them
    // and load the target file, while keeping the source markdown portable
    // (the source still has [[Foo]] — only the rendered output uses the scheme).
    const renderBody = useMemo(() => {
        return parsedBody.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
            const t = target.trim();
            const a = (alias ?? target).trim();
            return `[${a}](wikilink:${encodeURIComponent(t)})`;
        });
    }, [parsedBody]);

    // Lazy-load KaTeX only when the document actually contains math.
    // Heavy (~280kb) — keeping it out of the initial bundle is a real win.
    const [mathPlugins, setMathPlugins] = useState<PluginPair | null>(mathPluginsCache);
    useEffect(() => {
        if (mathPlugins) return;
        if (!hasMath(renderBody)) return;
        let cancelled = false;
        loadMathPlugins().then((p) => {
            if (!cancelled) setMathPlugins(p);
        });
        return () => { cancelled = true; };
    }, [renderBody, mathPlugins]);

    // Order matters: GFM first (its tokenizer must own `~~strike~~` before
    // the supersub text pass sees single tildes), math next when active
    // (`$a~b$` becomes an inlineMath node the text-level plugins skip), then the
    // extended syntaxes: ==mark==, ^sup^/~sub~, definition lists, {#id}. SYNTAX-01.
    const remarkPlugins = useMemo(
        () => (mathPlugins
            ? [[remarkGfm, GFM_OPTIONS], mathPlugins.remark, remarkFlexibleMarkers, remarkSupersub, remarkDefinitionList, remarkCustomHeadingId]
            : [[remarkGfm, GFM_OPTIONS], remarkFlexibleMarkers, remarkSupersub, remarkDefinitionList, remarkCustomHeadingId]),
        [mathPlugins]
    );
    const rehypePlugins = useMemo(
        () => (mathPlugins
            ? [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], mathPlugins.rehype, [rehypeHighlight, HIGHLIGHT_OPTIONS], rehypeSourceLine, rehypeHeadingIds]
            : [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], [rehypeHighlight, HIGHLIGHT_OPTIONS], rehypeSourceLine, rehypeHeadingIds]),
        [mathPlugins]
    );

    // Render the heavy markdown tree from a deferred copy of the body, updated
    // inside a transition. A burst of edits (already coalesced by App's debounce)
    // never blocks the commit that paints the latest keystroke, and React can
    // interrupt + restart this reconcile if newer input arrives. PREVIEW-01.
    const [renderedBody, setRenderedBody] = useState(renderBody);
    const [, startBodyTransition] = useTransition();
    useEffect(() => {
        startBodyTransition(() => setRenderedBody(renderBody));
    }, [renderBody]);

    // Cached scroll extent (scrollHeight - clientHeight). Reading scrollHeight in
    // the scroll handler forces a synchronous reflow on every event; instead we
    // refresh it via ResizeObserver + on content change and read the cache in the
    // hot path. PREVIEW-04.
    const scrollMaxRef = useRef(0);
    const refreshScrollMax = useCallback(() => {
        const el = mainRef.current;
        if (el) scrollMaxRef.current = el.scrollHeight - el.clientHeight;
    }, []);

    // Track scroll: update active-line indicator + report fraction for split-sync.
    // Coalesced to one update per animation frame so fast scrolling can't fire the
    // cross-pane sync (and its layout writes) many times per frame. PREVIEW-04.
    const scrollRafRef = useRef(0);
    const handleScroll = useCallback(() => {
        if (scrollRafRef.current) return;
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = 0;
            const element = mainRef.current;
            if (!element) return;
            const max = scrollMaxRef.current;
            const fraction = max > 0 ? element.scrollTop / max : 0;
            if (onLineChange) {
                // Accurate source line from the data-source-line anchors (made
                // content-relative via the frontmatter offset); fall back to the
                // fraction estimate before the body has rendered.
                const accurate = topSourceLine(element);
                const currentLine = accurate != null
                    ? accurate + fmOffsetRef.current
                    : (max <= 0 ? 1 : Math.max(1, Math.ceil(fraction * lineCount)));
                onLineChange(currentLine);
            }
            onScrollFraction?.(fraction);
        });
    }, [lineCount, onLineChange, onScrollFraction]);

    // Set up scroll listener
    useEffect(() => {
        const element = mainRef.current;
        if (!element) return;

        element.addEventListener("scroll", handleScroll);
        handleScroll();

        return () => {
            element.removeEventListener("scroll", handleScroll);
        };
    }, [handleScroll]);

    // Refresh the cached scroll extent on pane resize (split-divider drag, window
    // resize) and whenever the rendered body changes height. ResizeObserver fires
    // on box-size changes; the renderedBody effect covers content growth (which
    // changes scrollHeight without changing the element's own box). PREVIEW-04.
    useEffect(() => {
        refreshScrollMax();
        const el = mainRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(refreshScrollMax);
        ro.observe(el);
        return () => ro.disconnect();
    }, [refreshScrollMax]);
    useEffect(() => { refreshScrollMax(); }, [renderedBody, refreshScrollMax]);
    useEffect(() => () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); }, []);

    // Jump-to-line requests from the TOC / command palette (NAV-01). Finds the
    // last rendered block whose source line is at-or-above the target line via
    // the data-source-line anchors — exact even when headings repeat, unlike
    // the old text-matching approach. Lines are content-relative; the anchors
    // are body-relative, hence the frontmatter offset.
    useEffect(() => {
        const handler = (e: Event) => {
            const line = Number((e as CustomEvent).detail?.line);
            const container = mainRef.current;
            if (!container || !Number.isFinite(line) || line < 1) return;
            const target = line - fmOffsetRef.current;
            const blocks = container.querySelectorAll<HTMLElement>("[data-source-line]");
            let best: HTMLElement | null = null;
            for (const b of blocks) {
                const l = Number(b.getAttribute("data-source-line"));
                if (l <= target) best = b;
                else break;
            }
            if (!best) return;
            // Land the block a few px below the top edge so active-line
            // detection (which samples ~14px down) resolves to THIS block.
            const top = best.getBoundingClientRect().top
                - container.getBoundingClientRect().top
                + container.scrollTop - 8;
            container.scrollTo({ top, behavior: "auto" });
        };
        window.addEventListener("paperling:goto-line", handler);
        return () => window.removeEventListener("paperling:goto-line", handler);
    }, []);

    // Snap to the top when a different file is opened, so you don't land
    // mid-document at the previous file's scroll offset. NAV-04.
    useEffect(() => {
        const toTop = () => { if (mainRef.current) mainRef.current.scrollTop = 0; };
        window.addEventListener("paperling:scroll-top", toTop);
        return () => window.removeEventListener("paperling:scroll-top", toTop);
    }, []);

    // Register imperative scroller for split-view sync
    useEffect(() => {
        if (!registerScroller) return;
        registerScroller({
            setFraction: (f: number) => {
                const el = mainRef.current;
                if (!el) return;
                const max = el.scrollHeight - el.clientHeight;
                if (max > 0) el.scrollTop = max * f;
            },
        });
        return () => registerScroller(null);
    }, [registerScroller]);

    return (
        <>
            <main
                ref={mainRef}
                className="flex-1 overflow-y-auto bg-[var(--bg-primary)] transition-colors"
            >
                <div className="preview-column max-w-[800px] mx-auto px-8 py-12">
                    {hasFrontmatter && (
                        <FrontmatterCard
                            data={frontmatter}
                            editable={!!onContentChange}
                            onChange={(next) => {
                                if (!onContentChange) return;
                                onContentChange(serializeFrontmatter(next, parsedBody));
                            }}
                        />
                    )}
                    <div className="markdown-body" ref={markdownBodyRef}>
                        <Markdown
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            remarkPlugins={remarkPlugins as any}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            rehypePlugins={rehypePlugins as any}
                            remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
                            urlTransform={mdUrlTransform}
                            components={components}
                        >
                            {renderedBody}
                        </Markdown>
                    </div>
                </div>
            </main>

            {zoomImage && (
                <div
                    role="dialog"
                    aria-label={`Image: ${zoomImage.alt || "preview"}`}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out animate-fade-in"
                    onClick={() => setZoomImage(null)}
                >
                    <img
                        src={zoomImage.src}
                        alt={zoomImage.alt}
                        className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <button
                        type="button"
                        onClick={() => setZoomImage(null)}
                        aria-label="Close image"
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
            )}
        </>
    );
}

// React.memo so we skip the heavy markdown re-parse + reconcile when only
// the editor cursor moved or selection changed. App re-renders on every
// keystroke (live `content` state); without memo, that re-render flowed
// straight through and called react-markdown again with the same input.
// All inputs to MarkdownPreview are either stable (callbacks via useCallback,
// filePath/fileName) or genuine work triggers (debounced content) — the
// default shallow prop comparator is exactly what we want.
export const MarkdownPreview = memo(MarkdownPreviewImpl);
