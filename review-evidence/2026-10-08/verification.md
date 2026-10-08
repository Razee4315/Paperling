# Verification record — 2026-10-08

## Current PR evidence

- Queried all 201 PR records through authenticated GitHub CLI/API, then fetched current branches and read every open diff/check run. Read bodies/comments/file lists for all 35 closed/unmerged PRs, with targeted code confirmation of incorporated features.
- #263 `ed2fce60`: typecheck passed. Four deferred-I/O safety assertions failed: active reload discards new text; pending autosave writes during conflict; stale stat reactivates the former tab; background read discards edits made between checks. Reproduction source is preserved as `.txt` so it does not break normal test discovery.
- #263's attempted full suite was not clean: 636 tests passed, one live-preview assertion failed, two bundle tests skipped, and six suites could not collect because Vite rejected fonts/CSS resolved outside the detached worktree through a shared dependency junction. These setup errors are not attributed to the PR. A corrected full suite was not completed; the merge rejection rests on the focused deterministic safety reproductions.
- #266 `88007791`: typecheck passed. All 29 focused tests passed (five cache, 24 MarkdownPreview). A temporary test-only Vite `server.fs.allow` setting permitted the shared dependency directory; it was removed after testing. No tracked source changed.
- #266 actual-helper probe reproduces 147 orphaned object URLs after three refreshes with 50 references. See [source](pr266-probe.mjs.txt) and [output](pr266-probe-results.txt). Adjust the worktree import path when reproducing elsewhere.
- Dependency verdicts use the exact-head CI runs linked in the report. No local production build or Rust compilation was attempted.

## Live browser verification

T3 collaborative preview initially opened, then its automation host disconnected. `preview_open` explicitly reported unavailable. CUA also had no available browsers. Fallback: a temporary official `playwright-core` install outside the repository drove installed Edge headlessly, against the actual #266 Vite app on port 5289.

The dev-only fake Tauri backend supplied a disposable Markdown document. A browser-only invoke wrapper supplied image bytes and mtime, since the stock fake backend does not implement images. This exercises React/component/cache behavior, not native Rust file access, file sharing or OS focus delivery.

Clicked Open File to load a note with two references to the same SVG. Both showed Version 1; after simulated changed mtime and a focus event, both showed Version 2. Backend image reads increased from four on initial development-mode mount to six after one refresh: two replacement reads for the same image. See [before](pr266-before.png), [after](pr266-after.png) and [browser script](pr266-browser.mjs.txt). Screenshot visually inspected. The independent cache probe establishes the resource leak more precisely than screenshots can.

Native macOS tab dragging, native Windows image replacement/sharing, and real-file autosave races remain unverified locally. No claim that a browser fake validates Rust behavior.

## Baseline and report branch

The report branch starts from current main `7eeaa9f36b280d42af58c94738d7b394d0789dfc`, not the earlier review branch based on rejected #263. It contains review documents, inert reproduction source, screenshots and checklist changes only.

TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.

Full main-source suite:

1. First run: 690/692 passed; DOCX conversion exceeded 20 seconds and the live-preview heading assertion failed under concurrent work.
2. Second, serial run with 60-second timeout: 691/692 passed; DOCX passed but live-preview heading assertion still failed.
3. Final run: **73 files / 692 tests passed**, using `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=60000 --retry=1`. [Captured output](main-tests.txt). Retry was enabled; do not describe this as a guaranteed clean default-command baseline. No source, test expectation or test configuration was edited to obtain the result.

The intermittent live-preview failure is baseline behavior observed on unchanged main and on the PR worktree, not an established regression introduced by #263/#266. It deserves a separate deterministic parser/test investigation. No application fixes were authorized as part of the requested verdict, so this review records the limitation.

The repo hand-off workflow requests a Windows Test Build after pushing. Its run/artifact link is supplied with the final hand-off; because this branch changes review material only, that artifact contains current main application behavior and none of the rejected PR changes. Artifact retention is 14 days. No release or macOS build is requested.
