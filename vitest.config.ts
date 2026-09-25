/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Standalone test config so Vitest's options/types never leak into the Tauri +
// Vite production build (vite.config.ts). Vitest uses this file in preference to
// vite.config.ts when present. QUALITY-01.
export default defineConfig({
    plugins: [react()],
    resolve: {
        // Some @codemirror/lang-* packages carry their own nested copy of
        // @codemirror/state|view; without dedupe, vitest resolves two instances
        // and EditorState.create rejects extensions built by the other copy
        // ("Unrecognized extension value"). Vite's dep pre-bundling hides this
        // in dev/build, so it only bites in tests.
        // @codemirror/merge is here because reviewFind.integration.test.ts builds
        // a real unifiedMergeView state; a second @codemirror/state copy behind it
        // would fail EditorState.create with "Unrecognized extension value".
        dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language", "@codemirror/autocomplete", "@codemirror/lint", "@codemirror/merge"],
    },
    test: {
        environment: "jsdom",
        // One jsdom per worker instead of one per file: the default pool spent
        // ~2/3 of the run building environments, which starved the two
        // slowest tests (bundle scan, DOCX export) into load-dependent
        // timeouts — the suite was not reliably green. vmThreads keeps
        // per-file isolation. TEST-01.
        pool: "vmThreads",
        // Vitest normally hands node_modules to Node's resolver, which happily
        // loads the nested copies and ignores `resolve.dedupe` above — inline
        // the CodeMirror family so the deduped Vite resolution is used.
        server: { deps: { inline: [/@codemirror[\\/]/] } },
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        css: false,
        clearMocks: true,
        restoreMocks: true,
    },
});
