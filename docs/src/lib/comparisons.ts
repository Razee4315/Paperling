// Reviewed against primary sources on 2026-09-26.
export const comparisons = [
  {
    slug: "obsidian",
    name: "Obsidian",
    tagline: "A single file, or a connected collection?",
    description:
      "Compare Paperling and Obsidian: local Markdown files, vaults, plugins, optional AI, and sync. An honest guide to choosing your writing workflow.",
    intro:
      "Local Markdown in both. Paperling focuses on individual files; Obsidian on a connected collection of notes.",
    rows: [
      [
        "Start",
        "Open a Markdown file or folder directly",
        "Organize local notes in a vault",
      ],
      [
        "Cost",
        "Free, Apache-2.0 open source",
        "Core app free for personal and commercial use; optional paid services",
      ],
      [
        "Links",
        "Same-folder wikilinks and backlinks",
        "Linked notes, graph view, and an extensible ecosystem",
      ],
      ["Sync", "No built-in sync service", "Optional Obsidian Sync service"],
      [
        "Extras",
        "Bundled settings, themes, and Vim option",
        "Themes and community plugins",
      ],
    ],
    verdict:
      "Pick Paperling for straightforward file editing. Pick Obsidian for graphs, plugins, and a connected knowledge base.",
    sources: [
      ["Obsidian pricing and free use", "https://obsidian.md/pricing"],
      ["Obsidian vault documentation", "https://obsidian.md/help/vault"],
    ],
  },
  {
    slug: "typora",
    name: "Typora",
    tagline: "Two different ways to feel at home in Markdown.",
    description:
      "Compare Paperling and Typora for Markdown editing: split preview, inline editing, math, diagrams, licensing, and export workflows.",
    intro:
      "Separate source and preview, or seamless inline editing? That is the main choice.",
    rows: [
      [
        "Editing style",
        "Reader, Code, and side-by-side Split views",
        "Seamless inline editing with a source-code mode",
      ],
      [
        "License",
        "Free, Apache-2.0 open source",
        "Paid proprietary app with a trial",
      ],
      [
        "Technical notes",
        "KaTeX, mhchem chemistry, and Mermaid",
        "Math, chemistry, and diagram support",
      ],
      [
        "Focus tools",
        "Focus, typewriter, and Zen modes",
        "Focus and typewriter modes",
      ],
      [
        "Export",
        "HTML, PDF, and Word; platform caveats apply",
        "Multiple export formats; some require Pandoc",
      ],
    ],
    verdict:
      "Pick Paperling for free, open-source editing with explicit source views. Pick Typora for its seamless inline writing experience.",
    sources: [
      ["Typora features and licensing", "https://typora.io/"],
      ["Typora export documentation", "https://support.typora.io/Export/"],
    ],
  },
  {
    slug: "vscode",
    name: "VS Code",
    tagline: "A place to write, or your whole development desk?",
    description:
      "Compare Paperling and Visual Studio Code for Markdown: built-in previews, writing tools, extensions, and working alongside source code.",
    intro:
      "VS Code already previews Markdown. Paperling gives reading and writing their own space.",
    rows: [
      [
        "Main focus",
        "Markdown reading and writing",
        "General-purpose code editing and development",
      ],
      [
        "Markdown preview",
        "Reader and synchronized Split view",
        "Built-in preview and synchronized side preview",
      ],
      [
        "Tools around the document",
        "Writing modes, table tools, file navigation",
        "Integrated development tools and extension marketplace",
      ],
      [
        "Math and diagrams",
        "Bundled KaTeX, chemistry, and Mermaid",
        "Math support; extensions can add more rendering features",
      ],
      [
        "Best fit",
        "Notes, drafts, and standalone Markdown files",
        "Documentation inside a software project",
      ],
    ],
    verdict:
      "Pick Paperling for a focused document app. Stay with VS Code if terminals, Git, and code belong beside your Markdown.",
    sources: [
      [
        "VS Code Markdown documentation",
        "https://code.visualstudio.com/docs/languages/markdown",
      ],
      ["VS Code overview", "https://code.visualstudio.com/docs"],
    ],
  },
  {
    slug: "marktext",
    name: "MarkText",
    tagline: "Two open-source editors. Two writing rhythms.",
    description:
      "Compare Paperling and MarkText: open-source Markdown editors with different preview styles, writing tools, math, and export options.",
    intro:
      "Both free and open source. The main difference is how you prefer to edit.",
    rows: [
      [
        "License",
        "Apache-2.0, free and open source",
        "MIT, free and open source",
      ],
      [
        "Editing approach",
        "Reader, Code, and Split views",
        "Real-time inline preview and source-code mode",
      ],
      ["Math", "KaTeX math and mhchem chemistry", "KaTeX math"],
      [
        "Writing tools",
        "Focus, typewriter, slash commands, and table tools",
        "Focus, typewriter, and table editing",
      ],
      ["Export", "HTML, PDF, and Word with rendering caveats", "HTML and PDF"],
    ],
    verdict:
      "Pick Paperling for Reader, Code, and Split views. Pick MarkText if you prefer inline preview.",
    sources: [
      [
        "MarkText official repository and feature list",
        "https://github.com/marktext/marktext",
      ],
    ],
  },
];
