// Pandoc-style `^sup^` / `~sub~` for the preview (SYNTAX-01).
//
// Replaces the npm remark-supersub plugin, which split every text node on any
// even count of markers with no content rules — silently corrupting ordinary
// prose: "x^2 + y^2" became x<sup>2 + y</sup>2, "~/.config and ~/.bashrc"
// sprouted subscripts, and undefined footnote refs "[^a] and [^b]" broke.
// Pandoc's rule — content must be non-empty with no whitespace and no
// repeat of the marker — rejects all of those while keeping `x^2^` and
// `H~2~O` working.
//
// Runs on plain text nodes only: code spans/blocks are separate node types by
// the time this runs, math is extracted by remark-math earlier in the chain,
// and GFM (singleTilde: false) has already claimed `~~strike~~`.

interface MdNode {
    type: string;
    value?: string;
    children?: MdNode[];
    data?: { hName?: string };
}

const MARKER = /\^([^\s^]+)\^|~([^\s~]+)~/g;

function transformValue(value: string): MdNode[] | null {
    MARKER.lastIndex = 0;
    const out: MdNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER.exec(value)) !== null) {
        if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
        const sup = m[1] !== undefined;
        // Unknown mdast types render through data.hName (same mechanism the
        // npm plugin used), so remark-rehype emits real <sup>/<sub> elements.
        out.push({
            type: sup ? "superscript" : "subscript",
            data: { hName: sup ? "sup" : "sub" },
            children: [{ type: "text", value: sup ? m[1] : m[2] }],
        });
        last = m.index + m[0].length;
    }
    if (out.length === 0) return null;
    if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    return out;
}

export default function remarkSupersub() {
    return (tree: MdNode) => {
        const walk = (node: MdNode) => {
            const kids = node.children;
            if (!kids) return;
            for (let i = kids.length - 1; i >= 0; i--) {
                const child = kids[i];
                if (child.type === "text" && typeof child.value === "string") {
                    const replaced = transformValue(child.value);
                    if (replaced) kids.splice(i, 1, ...replaced);
                } else {
                    walk(child);
                }
            }
        };
        walk(tree);
    };
}
