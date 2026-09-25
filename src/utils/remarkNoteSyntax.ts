// Extended note syntax for the preview (SYNTAX-02). These are the de-facto
// conventions of popular note apps (Obsidian popularised them), supported so
// notes written elsewhere render correctly here:
//  - callouts: `> [!NOTE] Title` (optionally foldable `[!TIP]-` / `[!TIP]+`)
//  - tags: `#tag`, `#nested/tag` rendered as clickable pills
//  - comments: `%%hidden%%` (inline or multi-line), removed before parsing
//
// The slash menu has offered "Callout" since launch while the preview drew a
// plain blockquote with a literal "[!NOTE]" in it. Everything here emits
// elements through mdast `data.hName`, and the sanitize schema allows exactly
// the class names / attributes used, so rehype-sanitize still has the last
// word on what reaches the DOM.

interface MdNode {
    type: string;
    value?: string;
    children?: MdNode[];
    position?: unknown;
    data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Callout types we style; anything else renders with the "note" look. */
export const CALLOUT_TYPES = [
    "note", "abstract", "summary", "tldr", "info", "todo", "tip", "hint", "important",
    "success", "check", "done", "question", "help", "faq", "warning", "caution", "attention",
    "failure", "fail", "missing", "danger", "error", "bug", "example", "quote", "cite",
] as const;

const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Split a callout's first paragraph into its title inlines and the rest.
 * Title = everything up to the first newline (inline formatting allowed).
 */
function splitTitle(inlines: MdNode[]): { title: MdNode[]; rest: MdNode[] } {
    const title: MdNode[] = [];
    for (let i = 0; i < inlines.length; i++) {
        const node = inlines[i];
        if (node.type === "text" && typeof node.value === "string") {
            const nl = node.value.indexOf("\n");
            if (nl !== -1) {
                if (nl > 0) title.push({ type: "text", value: node.value.slice(0, nl) });
                const after = node.value.slice(nl + 1);
                const rest = after ? [{ type: "text", value: after }, ...inlines.slice(i + 1)] : inlines.slice(i + 1);
                return { title, rest };
            }
        }
        // A hard line break also ends the title line.
        if (node.type === "break") return { title, rest: inlines.slice(i + 1) };
        title.push(node);
    }
    return { title, rest: [] };
}

function toCallout(quote: MdNode): MdNode | null {
    const first = quote.children?.[0];
    if (!first || first.type !== "paragraph" || !first.children?.length) return null;
    const lead = first.children[0];
    if (lead.type !== "text" || typeof lead.value !== "string") return null;
    const m = lead.value.match(CALLOUT_RE);
    if (!m) return null;

    const rawType = m[1].toLowerCase();
    const fold = m[2]; // "", "+" (open) or "-" (closed)
    const strippedLead = { ...lead, value: lead.value.slice(m[0].length) };
    const inlines = strippedLead.value ? [strippedLead, ...first.children.slice(1)] : first.children.slice(1);
    const { title, rest } = splitTitle(inlines);
    const titleChildren = title.some((n) => n.type !== "text" || (n.value ?? "").trim())
        ? title
        : [{ type: "text", value: titleCase(rawType) }];

    const body: MdNode[] = [];
    if (rest.length) body.push({ type: "paragraph", children: rest });
    body.push(...(quote.children ?? []).slice(1));

    const foldable = fold === "+" || fold === "-";
    const kind = (CALLOUT_TYPES as readonly string[]).includes(rawType) ? rawType : "note";
    return {
        type: "callout",
        position: quote.position,
        data: {
            hName: foldable ? "details" : "div",
            hProperties: {
                className: ["callout"],
                dataCallout: kind,
                ...(fold === "+" ? { open: true } : {}),
            },
        },
        children: [
            {
                type: "calloutTitle",
                data: { hName: foldable ? "summary" : "div", hProperties: { className: ["callout-title"] } },
                children: titleChildren,
            },
            ...(body.length
                ? [{ type: "calloutContent", data: { hName: "div", hProperties: { className: ["callout-content"] } }, children: body }]
                : []),
        ],
    };
}

// Tag grammar (Obsidian-compatible): letters/digits/_/-// with at least one non-digit, and
// preceded by start-of-text or whitespace (so URLs' #fragments, `C#`, and
// "issue#12" stay text). Headings never reach here (they're heading nodes).
const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

function splitTags(value: string): MdNode[] | null {
    TAG_RE.lastIndex = 0;
    const out: MdNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(value)) !== null) {
        const start = m.index + m[1].length;
        if (start > last) out.push({ type: "text", value: value.slice(last, start) });
        out.push({
            type: "tag",
            data: { hName: "span", hProperties: { className: ["md-tag"], dataTag: m[2] } },
            children: [{ type: "text", value: `#${m[2]}` }],
        });
        last = start + 1 + m[2].length;
    }
    if (out.length === 0) return null;
    if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    return out;
}

/** Node types whose text must never be reinterpreted. */
const OPAQUE = new Set(["code", "inlineCode", "math", "inlineMath", "link", "linkReference", "html", "definition"]);

export default function remarkNoteSyntax() {
    return (tree: MdNode) => {
        const walk = (node: MdNode) => {
            const kids = node.children;
            if (!kids) return;
            for (let i = kids.length - 1; i >= 0; i--) {
                const child = kids[i];
                if (child.type === "blockquote") {
                    const callout = toCallout(child);
                    if (callout) {
                        kids[i] = callout;
                        walk(callout);
                        continue;
                    }
                }
                if (child.type === "text" && typeof child.value === "string") {
                    const replaced = splitTags(child.value);
                    if (replaced) kids.splice(i, 1, ...replaced);
                } else if (!OPAQUE.has(child.type)) {
                    walk(child);
                }
            }
        };
        walk(tree);
    };
}

/**
 * Remove `%%comments%%` outside code fences, keeping every newline so source
 * line numbers (scroll sync, task write-back) still line up. An unclosed
 * `%%` hides the rest of the document (the common convention).
 */
export function stripNoteComments(body: string): string {
    if (!body.includes("%%")) return body;
    const out: string[] = [];
    let inFence = false;
    let inComment = false;
    for (const line of body.split("\n")) {
        if (!inComment && /^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            out.push(line);
            continue;
        }
        if (inFence) {
            out.push(line);
            continue;
        }
        let result = "";
        // Inline code spans (odd indices) are literal: `50%%` in code is text.
        line.split(/(`+[^`]*`+)/).forEach((segment, i) => {
            if (i % 2 === 1) {
                if (!inComment) result += segment;
                return;
            }
            let rest = segment;
            while (rest.length) {
                const idx = rest.indexOf("%%");
                if (idx === -1) {
                    if (!inComment) result += rest;
                    break;
                }
                if (!inComment) result += rest.slice(0, idx);
                inComment = !inComment;
                rest = rest.slice(idx + 2);
            }
        });
        out.push(result);
    }
    return out.join("\n");
}
