/**
 * Local-only font loading. Every font face the app uses is bundled with the
 * app — no requests to fonts.googleapis.com / fonts.gstatic.com — so Paperling
 * looks identical with or without an internet connection.
 *
 * We import the `latin-*` CSS files from each @fontsource package because they
 * register only the latin subset's @font-face. That keeps the bundled woff2
 * footprint reasonable while still covering the full ASCII + western-European
 * character set the editor / preview ever displays. Each import resolves to a
 * woff2 URL that Vite fingerprints and copies into `dist/assets/`.
 *
 * Weights match the set the previous Google Fonts <link> tag pulled, so the
 * UI renders byte-identical to before — just served from disk.
 */

// Inter — primary sans (Settings → Appearance default)
import "@fontsource/inter/latin-300.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";

// JetBrains Mono — code editor + inline `code`. NOT loaded via the @fontsource
// CSS file because that uses `font-display: swap`, which makes the editor
// glyphs swap from a fallback monospace (e.g. Consolas) to JetBrains Mono once
// the woff2 finishes downloading. The textarea's caret position is computed
// against whatever font the textarea is currently rendering with, while the
// syntax-highlight overlay re-flows simultaneously with slightly different
// glyph advance widths — leaving the caret visually offset from the rendered
// text. We override to `font-display: block` so the editor never paints in a
// fallback metric: text is hidden for at most ~3s while the (already bundled,
// near-instant) woff2 loads, and once shown it never reflows again.
import jetbrainsMono400Url from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url";
import jetbrainsMono500Url from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url";

const jetbrainsMonoFaces = `
@font-face {
    font-family: 'JetBrains Mono';
    font-style: normal;
    font-display: block;
    font-weight: 400;
    src: url(${jetbrainsMono400Url}) format('woff2');
}
@font-face {
    font-family: 'JetBrains Mono';
    font-style: normal;
    font-display: block;
    font-weight: 500;
    src: url(${jetbrainsMono500Url}) format('woff2');
}`;

if (typeof document !== "undefined") {
    const style = document.createElement("style");
    style.setAttribute("data-paperling-fonts", "jetbrains-mono");
    style.textContent = jetbrainsMonoFaces;
    document.head.appendChild(style);
    // Eagerly kick off the font load so the editor doesn't sit blank for any
    // perceptible window. With `block` display the page would still wait up to
    // ~3s of natural browser timing; this gets us closer to ~50ms.
    if (document.fonts && typeof document.fonts.load === "function") {
        document.fonts.load("400 14px 'JetBrains Mono'").catch(() => {});
        document.fonts.load("500 14px 'JetBrains Mono'").catch(() => {});
    }
}

// Alternate body fonts (Merriweather, Lora, Source Serif 4, Fira Sans) are NOT
// imported eagerly anymore — see ensureFontLoaded() below. Inter is the default,
// so a typical session shipped four extra families' CSS + woff2 for nothing.
// QUALITY-03.

// Material Symbols Outlined — every UI icon. The package ships the variable
// woff2 with the wght axis (100..700); FILL/GRAD/opsz are tuned via inline
// `font-variation-settings` in `index.css`, so the same icon glyphs render
// even when offline.
import "material-symbols/outlined.css";

// On-demand loaders for the alternate body fonts. Each resolves to a separate
// async chunk so the woff2 + CSS only download when the user actually selects
// the family (or on launch if it was their persisted choice). QUALITY-03.
const FONT_LOADERS: Record<string, () => Promise<unknown>> = {
    merriweather: () => Promise.all([
        import("@fontsource/merriweather/latin-300.css"),
        import("@fontsource/merriweather/latin-400.css"),
        import("@fontsource/merriweather/latin-700.css"),
    ]),
    lora: () => Promise.all([
        import("@fontsource/lora/latin-400.css"),
        import("@fontsource/lora/latin-500.css"),
        import("@fontsource/lora/latin-600.css"),
        import("@fontsource/lora/latin-700.css"),
    ]),
    "source-serif": () => Promise.all([
        import("@fontsource/source-serif-4/latin-300.css"),
        import("@fontsource/source-serif-4/latin-400.css"),
        import("@fontsource/source-serif-4/latin-500.css"),
        import("@fontsource/source-serif-4/latin-600.css"),
        import("@fontsource/source-serif-4/latin-700.css"),
    ]),
    "fira-sans": () => Promise.all([
        import("@fontsource/fira-sans/latin-300.css"),
        import("@fontsource/fira-sans/latin-400.css"),
        import("@fontsource/fira-sans/latin-500.css"),
        import("@fontsource/fira-sans/latin-600.css"),
        import("@fontsource/fira-sans/latin-700.css"),
    ]),
};

// Inter ships eagerly above; mark it loaded so we never try to fetch it.
const loadedFonts = new Set<string>(["inter"]);

/** Ensure a body font family's @fontsource CSS is loaded. Idempotent; a no-op
 *  for the default Inter and for unknown families. */
export function ensureFontLoaded(family: string): void {
    if (loadedFonts.has(family)) return;
    const loader = FONT_LOADERS[family];
    if (!loader) return;
    loadedFonts.add(family);
    loader().catch(() => loadedFonts.delete(family));
}
