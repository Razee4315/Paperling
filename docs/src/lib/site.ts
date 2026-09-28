export const SITE = {
  name: "Paperling",
  origin: "https://razee4315.github.io",
  base: "/Paperling/",
  repo: "https://github.com/Razee4315/Paperling",
  releases: "https://github.com/Razee4315/Paperling/releases/latest",
};

// WEB-01: one URL policy for navigation, canonicals, JSON-LD and the sitemap.
// Keep the established project path; relative links break on nested Pages routes.
export function url(path = ""): string {
  if (/^(https?:|mailto:|#)/.test(path)) return path;
  return SITE.base + path.replace(/^\/+/, "");
}
export function absolute(path = ""): string {
  return new URL(url(path), SITE.origin).href;
}

export const features = [
  {
    slug: "live-preview",
    title: "Markdown, beautifully rendered.",
    name: "Live preview",
    description:
      "Read Markdown, edit the source, or keep both side by side with a synchronized live preview.",
    intro: "Read, write, or see both at once.",
    sections: [
      [
        "Read without the punctuation",
        "Open a .md file directly. Reader view renders headings, tables, task lists, callouts, and code without the Markdown punctuation.",
      ],
      [
        "Keep the source in sight",
        "Split view pairs your source with a synchronized preview. Code view gives the editor the full window.",
      ],
      [
        "Keep everyday Markdown portable",
        "Your files stay plain-text Markdown. Math and diagram extensions need a compatible renderer in other apps.",
      ],
    ],
  },
  {
    slug: "math-and-diagrams",
    title: "Big ideas. Clear notation.",
    name: "Math & diagrams",
    description:
      "Write KaTeX math, mhchem chemistry, and Mermaid diagrams directly in your Markdown documents.",
    intro: "Keep the equation, diagram, and explanation in one file.",
    sections: [
      [
        "Math that belongs in your notes",
        "Use $ for inline math and $$ for display equations. KaTeX renders the result in your preview.",
      ],
      [
        "Chemistry, without image attachments",
        "Write chemical formulae with mhchem notation inside math expressions. The formula stays editable text.",
      ],
      [
        "Diagrams from a few lines of text",
        "Use a fenced mermaid block for flowcharts, sequence diagrams, and more. Edit the text to update the diagram.",
      ],
    ],
  },
  {
    slug: "focused-writing",
    title: "A little room to think.",
    name: "Focused writing",
    description:
      "Write with focus and typewriter modes, slash commands, visual table tools, and seven built-in themes.",
    intro: "A comfortable page, with the tools close by.",
    sections: [
      [
        "Find your writing rhythm",
        "Focus mode dims surrounding lines. Typewriter mode centers your caret. Zen mode clears the surrounding interface.",
      ],
      [
        "Make structure feel natural",
        "Use slash commands, formatting shortcuts, and visual table tools. Tab moves between table cells.",
      ],
      [
        "Make the page feel like yours",
        "Seven themes, adjustable reading fonts, right-to-left text support, custom shortcuts, and an optional Vim mode.",
      ],
    ],
  },
  {
    slug: "ai-assistant",
    title: "A second pair of eyes. Your final say.",
    name: "Optional AI",
    description:
      "Connect an OpenAI-compatible provider, ask about a document, and review proposed AI edits inside Paperling.",
    intro: "A little help when you want it. Off when you do not.",
    sections: [
      [
        "Bring a provider you choose",
        "Connect an OpenAI-compatible endpoint in Settings → AI. Cloud providers may charge; local servers need their own setup.",
      ],
      [
        "Ask, then review",
        "Ask questions or request changes. Review the inline diff, then accept or reject it. Always check the facts.",
      ],
      [
        "Know where the text goes",
        "Remote providers receive the context you send. A local model server is another option. Ordinary editing works without AI.",
      ],
    ],
  },
  {
    slug: "local-files",
    title: "Your files. In your folders.",
    name: "Local files",
    description:
      "Open ordinary Markdown files, browse a folder, follow wikilinks, and keep your notes in a portable text format.",
    intro: "Open the files you already have. No vault required.",
    sections: [
      [
        "Start with one file",
        "Open a .md file or browse a folder, and create, rename or trash notes from the file panel. Unsaved changes survive a crash.",
      ],
      [
        "Give your notes a little context",
        "Navigate headings with the outline. Same-folder wikilinks and backlinks connect related notes.",
      ],
      [
        "Keep sync a separate choice",
        "There is no built-in cloud sync. Use your own storage tools, keep backups, and avoid simultaneous edits.",
      ],
    ],
  },
  {
    slug: "export",
    title: "From your page to theirs.",
    name: "Export & sharing",
    description:
      "Share Markdown documents with HTML, PDF, and Word export options, with platform-specific printing behavior.",
    intro: "Keep the Markdown original. Share a copy in another format.",
    sections: [
      [
        "HTML for a rendered document",
        "Export a rendered HTML document. Check local image references before sharing.",
      ],
      [
        "PDF for a finished page",
        "Windows and macOS use native PDF export; Linux uses a print dialog. Review page breaks before sharing.",
      ],
      [
        "Word when the workflow needs it",
        "Export to Word for word-processor workflows. Complex formatting may differ; keep the Markdown original.",
      ],
    ],
  },
];

export const faqs = [
  [
    "Is Paperling free?",
    "Yes. Paperling is free and open source under Apache-2.0, for personal and commercial use. Optional third-party AI providers may charge for their service.",
  ],
  [
    "Do I need an account or a vault?",
    "No. Download the app and open a Markdown file. There is no Paperling account, vault setup, or plugin installation required for the bundled editor features.",
  ],
  [
    "Can I use it offline?",
    "Yes, local reading and editing work offline. Remote AI, online images, and update checks can use the network. Choose a local AI setup if you want local inference.",
  ],
  [
    "Which platforms can I download it for?",
    "Windows, macOS, Linux, and Android. Android is distributed as an arm64 APK on GitHub Releases. There is currently no iOS version.",
  ],
  [
    "Does Paperling support right-to-left languages?",
    "Yes. Arabic, Hebrew, Persian and Urdu lines read right-to-left automatically in the editor and the reader, while code stays left-to-right. You can also force a direction in Settings → Editor → Text direction.",
  ],
  [
    "Can I use my existing Markdown notes?",
    "Yes. Open existing .md files directly. App-specific plugins, embeds, and some Markdown extensions from other editors may render differently. Keep a backup when trying a new workflow.",
  ],
  [
    "Does Paperling sync between devices?",
    "There is no built-in sync service. Your documents are ordinary files that you can manage with your own storage and backup tools. Avoid editing the same file simultaneously on multiple devices.",
  ],
  [
    "Is the AI required?",
    "No. AI is optional and requires a compatible provider configuration. Remote providers receive the context you send; local models need a local server. Review suggested edits before accepting them.",
  ],
  [
    "Where can I report a problem?",
    "Use the Issues page on the Paperling GitHub repository. Include your app version, operating system, and steps to reproduce. Remove private document contents and API keys from reports.",
  ],
];

export const utilityPages = [
  "download",
  "guide",
  "shortcuts",
  "faq",
  "privacy",
  "open-source",
  "changelog",
];
export const comparisonSlugs = ["obsidian", "typora", "vscode", "marktext"];
export const paths = [
  "",
  "features/",
  ...features.map((f) => `features/${f.slug}/`),
  "compare/",
  ...comparisonSlugs.map((s) => `compare/${s}/`),
  ...utilityPages.map((s) => `${s}/`),
];
