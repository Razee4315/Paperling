// Duplicate @codemirror/state copies in the PRODUCTION bundle throw
// "Unrecognized extension value in extension set" the moment the editor
// mounts — the packaged app booted straight into the error boundary while
// dev (esbuild pre-bundling) looked fine. vite.config.ts dedupes the
// CodeMirror family; this counts the copies actually bundled so a lockfile
// re-resolution can't silently reintroduce nested duplicates. Runs against
// dist/, which CI builds before testing; skips locally when dist is absent.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ASSETS = resolve(__dirname, "../../dist/assets");
// Appears exactly twice in @codemirror/state's source, so copies = count / 2.
const STATE_MARKER = /Unrecognized extension value/g;

describe.skipIf(!existsSync(ASSETS))("production bundle integrity", () => {
    it("bundles exactly one copy of @codemirror/state", () => {
        let occurrences = 0;
        for (const f of readdirSync(ASSETS).filter((f) => f.endsWith(".js"))) {
            occurrences += (readFileSync(join(ASSETS, f), "utf8").match(STATE_MARKER) ?? []).length;
        }
        expect(occurrences, "occurrences of the state marker string (2 per copy)").toBe(2);
    });

    // src/dev/fakeTauri.ts is a browser-testing shim behind import.meta.env.DEV;
    // it answers file commands from localStorage and must never ship.
    it("does not bundle the dev-only fake Tauri backend", () => {
        for (const f of readdirSync(ASSETS).filter((f) => f.endsWith(".js"))) {
            expect(readFileSync(join(ASSETS, f), "utf8").includes("[fakefs]"), f).toBe(false);
        }
    });
});
