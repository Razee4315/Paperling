import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // CodeMirror ships as a family of packages that each `instanceof`-check
  // objects from @codemirror/state; some @codemirror/lang-* packages carry
  // their own NESTED copies in node_modules, and without dedupe Rollup
  // bundles every copy (6 were counted in one build). Two state instances in
  // one editor throw "Unrecognized extension value in extension set" at
  // runtime — the app booted to the error boundary. Force the whole family
  // to resolve to the root copy. Mirrors vitest.config.ts. EDITOR-01.
  resolve: {
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/autocomplete",
      "@codemirror/commands",
      "@codemirror/lint",
      "@codemirror/search",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Bundle splitting. Without this, every npm dep our React tree touches
  // ends up in the single index-*.js chunk and the main bundle balloons past
  // 1 MB even though half of it is "stable across releases" vendor code that
  // could be cached forever. Splitting along these seams gives the WebView2
  // disk cache something to keep across upgrades, and lets the browser parse
  // the smaller main chunk quicker on cold start.
  build: {
    // Headroom over the largest legitimately-large chunk (mermaid.core ~580 kB).
    // We don't want Vite spamming warnings for chunks we know about.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Path-regex chunking (function form) for precise control — the object
        // form matches by substring and could miscategorise (e.g. "react" vs
        // "react-markdown"). Only big, clearly-isolated packages are rerouted;
        // everything else follows Rollup's default vendor chunking so shared
        // deps (micromark/unist/hast, used by both markdown and katex) aren't
        // duplicated. QUALITY-02.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          // React core — never split apart in practice. ~150 kB minified.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          // Mermaid (~580 kB) — only ever loaded via dynamic import, so this
          // stays an async chunk off the cold-start path.
          if (/[\\/]node_modules[\\/]mermaid[\\/]/.test(id)) return "mermaid";
          // KaTeX + its remark/rehype glue — also dynamically imported (math docs only).
          if (/[\\/]node_modules[\\/](katex|rehype-katex|remark-math)[\\/]/.test(id)) return "katex";
          // highlight.js + lowlight + rehype-highlight — split out of the
          // markdown chunk so the syntax-highlighting payload caches separately.
          if (/[\\/]node_modules[\\/](rehype-highlight|lowlight|highlight\.js)[\\/]/.test(id)) return "highlight";
          // Markdown rendering pipeline. Rarely changes per release.
          if (/[\\/]node_modules[\\/](react-markdown|remark-gfm)[\\/]/.test(id)) return "markdown";
        },
      },
    },
  },
}));
