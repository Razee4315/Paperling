// WEB-04: the hand-drawn mascot and icon set from the earlier site, restored.
// Kept apart from site.ts because image imports only resolve inside Astro,
// while site.ts is also loaded by plain Node in scripts/site.test.mjs.
import type { ImageMetadata } from "astro";
import iconSplitView from "../assets/mascot/icon-split-view.png";
import iconMath from "../assets/mascot/icon-math.png";
import iconPencil from "../assets/mascot/icon-pencil.png";
import iconSparkles from "../assets/mascot/icon-sparkles.png";
import iconFolder from "../assets/mascot/icon-folder.png";
import iconExportPdf from "../assets/mascot/icon-export-pdf.png";
import iconSlash from "../assets/mascot/icon-slash.png";
import iconCommandPalette from "../assets/mascot/icon-command-palette.png";
import iconLinkPages from "../assets/mascot/icon-link-pages.png";
import iconThemeSwatches from "../assets/mascot/icon-theme-swatches.png";
import iconDiagram from "../assets/mascot/icon-diagram.png";
import iconTable from "../assets/mascot/icon-table.png";
import iconBook from "../assets/mascot/icon-book.png";
import iconCheckBadge from "../assets/mascot/icon-check-badge.png";
import iconKeyboard from "../assets/mascot/icon-keyboard.png";
import iconLock from "../assets/mascot/icon-lock.png";

export { default as mascotWave } from "../assets/mascot/mascot-wave.png";
export { default as mascotRocket } from "../assets/mascot/mascot-rocket.png";
export { default as mascotPaint } from "../assets/mascot/mascot-paint.png";
export { default as mascotJuggle } from "../assets/mascot/mascot-juggle.png";
export { default as mascotCrumpled } from "../assets/mascot/mascot-crumpled.png";

/** One icon per feature page, keyed by the slugs in site.ts. */
export const featureIcons: Record<string, ImageMetadata> = {
  "live-preview": iconSplitView,
  "math-and-diagrams": iconMath,
  "focused-writing": iconPencil,
  "ai-assistant": iconSparkles,
  "local-files": iconFolder,
  export: iconExportPdf,
};

/** The homepage "what's in the box" grid. Every line must stay true of the app. */
export const toolkit: { icon: ImageMetadata; name: string; text: string }[] = [
  {
    icon: iconSplitView,
    name: "Reader, Code, Split",
    text: "Read it rendered, edit the source, or keep both side by side.",
  },
  {
    icon: iconSlash,
    name: "Slash commands",
    text: "Type / for headings, lists, tables, math, and callouts.",
  },
  {
    icon: iconCommandPalette,
    name: "Command palette",
    text: "Jump to any command, file, or heading from the keyboard.",
  },
  {
    icon: iconDiagram,
    name: "Mermaid diagrams",
    text: "Flowcharts and sequence diagrams from a few lines of text.",
  },
  {
    icon: iconTable,
    name: "Table tools",
    text: "Edit Markdown tables visually. Tab moves between cells.",
  },
  {
    icon: iconLinkPages,
    name: "Wikilinks & backlinks",
    text: "Link notes with [[double brackets]] and see what points back.",
  },
  {
    icon: iconThemeSwatches,
    name: "Seven themes",
    text: "Light, dark, paper, and more, with adjustable reading fonts.",
  },
  {
    icon: iconBook,
    name: "Zen mode",
    text: "Press F9 and everything but the page steps aside.",
  },
  {
    icon: iconCheckBadge,
    name: "Careful saves",
    text: "If a file changed on disk, Paperling asks before overwriting.",
  },
  {
    icon: iconExportPdf,
    name: "Export",
    text: "Share your document as HTML, PDF, or Word.",
  },
  {
    icon: iconKeyboard,
    name: "Optional Vim mode",
    text: "Modal editing for those who want it. Off by default.",
  },
  {
    icon: iconLock,
    name: "No account",
    text: "No sign-in. Your notes stay ordinary files in your folders.",
  },
];
