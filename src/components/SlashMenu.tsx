import { useEffect, useRef, useState } from "react";

export interface SlashCommand {
    id: string;
    label: string;
    description: string;
    /** Markdown the command inserts when chosen. */
    snippet: string;
    /** Caret offset inside `snippet` after insertion (0 = beginning). */
    caretOffset?: number;
    icon: string;
}

const commands: SlashCommand[] = [
    { id: "h1", label: "Heading 1", description: "# Heading", snippet: "# ", caretOffset: 2, icon: "format_h1" },
    { id: "h2", label: "Heading 2", description: "## Heading", snippet: "## ", caretOffset: 3, icon: "format_h2" },
    { id: "h3", label: "Heading 3", description: "### Heading", snippet: "### ", caretOffset: 4, icon: "format_h3" },
    { id: "ul", label: "Bullet list", description: "- item", snippet: "- ", caretOffset: 2, icon: "format_list_bulleted" },
    { id: "ol", label: "Numbered list", description: "1. item", snippet: "1. ", caretOffset: 3, icon: "format_list_numbered" },
    { id: "task", label: "Task list", description: "- [ ] todo", snippet: "- [ ] ", caretOffset: 6, icon: "check_box" },
    { id: "quote", label: "Quote", description: "> blockquote", snippet: "> ", caretOffset: 2, icon: "format_quote" },
    { id: "code", label: "Code block", description: "```\\ncode\\n```", snippet: "```\n\n```\n", caretOffset: 4, icon: "code" },
    { id: "table", label: "Table", description: "| h | h |\\n| - | - |", snippet: "| Header 1 | Header 2 |\n| --- | --- |\n| Cell | Cell |\n", caretOffset: 11, icon: "table_chart" },
    { id: "hr", label: "Divider", description: "Horizontal rule", snippet: "\n---\n\n", caretOffset: 6, icon: "horizontal_rule" },
    { id: "math", label: "Math block", description: "$$ ... $$", snippet: "$$\n\n$$\n", caretOffset: 3, icon: "function" },
    { id: "chem", label: "Chemistry equation", description: "$\\ce{...}$ (mhchem)", snippet: "$\\ce{}$", caretOffset: 5, icon: "science" },
    { id: "mermaid", label: "Mermaid diagram", description: "```mermaid", snippet: "```mermaid\ngraph LR\n  A --> B\n```\n", caretOffset: 11, icon: "schema" },
    { id: "callout", label: "Callout", description: "> [!NOTE]", snippet: "> [!NOTE]\n> ", caretOffset: 12, icon: "info" },
];

export interface SlashMenuPosition {
    x: number;
    y: number;
}

interface SlashMenuProps {
    isOpen: boolean;
    position: SlashMenuPosition | null;
    query: string;
    onSelect: (cmd: SlashCommand) => void;
    onClose: () => void;
}

export function SlashMenu({ isOpen, position, query, onSelect, onClose }: SlashMenuProps) {
    const [activeIdx, setActiveIdx] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    const filtered = query
        ? commands.filter((c) =>
            c.label.toLowerCase().includes(query.toLowerCase()) ||
            c.id.toLowerCase().includes(query.toLowerCase())
        )
        : commands;

    useEffect(() => { setActiveIdx(0); }, [query, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => (i + 1) % filtered.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
                if (filtered[activeIdx]) {
                    e.preventDefault();
                    onSelect(filtered[activeIdx]);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", handler, true);
        return () => document.removeEventListener("keydown", handler, true);
    }, [isOpen, activeIdx, filtered, onSelect, onClose]);

    if (!isOpen || !position || filtered.length === 0) return null;

    return (
        <div
            role="listbox"
            aria-label="Slash commands"
            className="fixed z-[80] w-72 max-h-72 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-2xl animate-fade-in"
            style={{ left: position.x, top: position.y }}
        >
            <ul ref={listRef} className="py-1">
                {filtered.map((cmd, i) => {
                    const active = i === activeIdx;
                    return (
                        <li key={cmd.id}>
                            <button
                                role="option"
                                aria-selected={active}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => onSelect(cmd)}
                                onMouseEnter={() => setActiveIdx(i)}
                                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${active ? "bg-[var(--bg-hover)]" : ""}`}
                            >
                                <span className={`material-symbols-outlined text-[18px] shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                                    {cmd.icon}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="text-sm text-[var(--text-primary)] block">{cmd.label}</span>
                                    <span className="text-[11px] text-[var(--text-muted)] font-mono truncate block">{cmd.description}</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
