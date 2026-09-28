// `# Title {#custom-id}` heading ids (SYNTAX-01).
//
// Replaces the npm remark-heading-id plugin, which required all of lodash
// (~93 kB minified added to the preview chunk) for an options path this app
// never enables. Only ids that are valid, addressable anchors
// ([A-Za-z][A-Za-z0-9_-]*) are claimed; anything else — spaces, leading
// digits — stays literal text rather than minting an id no `[link](#...)`
// could reach. rehypeHeadingIds respects the resulting hProperties.id
// downstream and keeps auto-slugs as the fallback.

interface MdNode {
    type: string;
    value?: string;
    children?: MdNode[];
    data?: { hProperties?: Record<string, unknown> };
}

const HEADING_ID = /[ \t]*\{#([A-Za-z][A-Za-z0-9_-]*)\}[ \t]*$/;

export default function remarkCustomHeadingId() {
    return (tree: MdNode) => {
        const walk = (node: MdNode) => {
            if (node.type === "heading" && node.children?.length) {
                const lastChild = node.children[node.children.length - 1];
                if (lastChild.type === "text" && typeof lastChild.value === "string") {
                    const m = lastChild.value.match(HEADING_ID);
                    if (m && m.index !== undefined) {
                        lastChild.value = lastChild.value.slice(0, m.index);
                        if (lastChild.value === "") node.children.pop();
                        node.data = node.data ?? {};
                        node.data.hProperties = { ...node.data.hProperties, id: m[1] };
                    }
                }
            }
            node.children?.forEach(walk);
        };
        walk(tree);
    };
}
