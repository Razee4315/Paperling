| Priority | Item | Type / effort | Verified outcome |
|---|---|---|---|
| P1 | PR #260 | Windows dependency compatibility / medium | Windows x64 and ARM compilation fail. Do not merge. |
| P1 | PR #249 | Frontend dependency compatibility / medium | Desktop and Android typechecking fail; duplicate CodeMirror packages. Do not merge. |
| P1 | PR #246 | Website tooling / small | TypeScript 7 cannot run the current Astro checker. Do not merge. |
| P1 | PR #244 | Website tooling / medium | Astro 7 is forced onto Vite 7; website build fails. Do not merge. |
| P2 | Issue #262 | macOS fullscreen / medium | Frontend routing defect confirmed in code and live browser; native Mac verification remains required. |
| P2 | Issue #212 | Distribution / large | Manifests exist and release hashes match; repository publication remains incomplete. |
| P2 | PR #245 | Runtime/types alignment / small | Checks green, but Node 26 types target a Node 24 runtime. Maintenance concern, not a reproduced runtime bug. |
| — | PR #247 | CI dependency / small | Checks green; no blocker found. Refresh against current main before merging. |

# GitHub verification — 2026-10-04

Scope: all **two open issues and six open PRs**, including issue comments, PR diffs and CI logs. Reviewed main at `bbacaee4ab8e52721b0de44b5aeb0d3aaf2b5ad6`. This is a review, not an implementation pass. No issue comments, PR reviews, merges, closes, dependency updates or product changes were made. All six PRs are linked to the T3 thread.

## Issue #262 — macOS fullscreen controls (P2)

[Issue](https://github.com/Razee4315/Paperling/issues/262). Evidence: `src/components/TitleBar.tsx:55–66`, `src/config/keybindings.ts:57`, `src/hooks/useGlobalShortcuts.ts:87–95`, and `src-tauri/tauri.conf.json:25`.

```ts
await appWindow.toggleMaximize();
// keybindings.ts
fullscreen: { key: "F11" },
```

The custom maximize button only maximizes unless the app already thinks it is fullscreen. Native decorations are disabled, so the user has no native green traffic-light control. Control+Command+F has no binding. The shortcut handler's comment assumes a green button exists; that assumption contradicts the shipped custom chrome. Maximizing and entering a native fullscreen Space are different operations.

Live browser verification used the real Vite frontend, a MacIntel platform override, and the existing `?fakefs=1` development backend. Clicking Maximize logged `plugin:window|toggle_maximize`; Control+Command+F logged no window operation; F11 logged `plugin:window|set_fullscreen` with `value: true`, and the title button changed to Exit fullscreen. This proves frontend dispatch, **not** native fullscreen, Dock hiding or Space behavior. Screenshot: `review-evidence/2026-10-04-fullscreen.png`.

Concrete fix: add the macOS Control+Command+F binding through the central keybinding system, route the macOS title-bar fullscreen control to the existing fullscreen action, and make labels/hints platform-aware. Preserve Windows maximize behavior. Add shortcut/title-bar regression tests and verify native enter/exit on a Mac, including Escape/native exits and restored window geometry. Existing `useFullscreen.ts:48–67` already calls `setFullscreen`; no new Rust command is evidently required. Do not claim a native fix from mocked browser evidence alone.

Related P3: `.github/ISSUE_TEMPLATE/bug_report.yml:43` still offers only `macOS (built from source)`, despite an official DMG. Change this to macOS and let installation source be reported separately.

## Issue #212 — package repositories (P2)

[Issue](https://github.com/Razee4315/Paperling/issues/212). The existing owner comment correctly leaves this open. `packaging/README.md:66` instructs creation of a Scoop bucket, and `:84–94` describes a Homebrew personal tap; these are publishing instructions, not evidence of publication. apt and F-Droid are still roadmap entries. `flake.nix:16` supports only `x86_64-linux`:

```nix
flake-utils.lib.eachSystem [ "x86_64-linux" ] (system:
```

Scoop `packaging/scoop/paperling.json:10` and Homebrew `packaging/homebrew/paperling.rb:7` hashes match GitHub's current v1.1.0 release asset digests. The portable ZIP is `1e0e52a256802e1802689d80b8c090f8e462653c65eb53e1993d6fcb3c500010`; the universal DMG is `3c918f64568df9d05ae53b4bbdf5577e361c59be749f4b2b1d246e26276558cc`. This checks manifest metadata against the release API, not fresh downloaded bytes or end-to-end installations. [Release](https://github.com/Razee4315/Paperling/releases/tag/v1.1.0).

Why it matters: users cannot infer that ordinary package-manager installation and updates work merely because manifests exist in this source repository. Concrete next work: publish and test the Scoop bucket and Homebrew tap, validate Nix installation from the documented flake, and separately implement apt signing/hosting and an F-Droid source-build recipe. Registry publication and native install/update tests were outside this verification pass. No claim is made that every possible third-party registry was exhaustively searched.

## PR #260 — incompatible Windows COM dependencies (P1)

[PR](https://github.com/Razee4315/Paperling/pull/260), head `7f6200a6cef152f9bbd361a47e0c7d75dbcfa623`.

At that head, `src-tauri/Cargo.lock:4697–4698` keeps MCP bridge 0.13.0 on `webview2-com 0.38.2` / `windows 0.61.3`, while `:6376–6377` moves Wry to `webview2-com 0.39.1` / `windows 0.62.2`. The app also retains this direct dependency at `src-tauri/Cargo.toml:70`:

```toml
webview2-com = "0.38"
```

Both Windows jobs fail with E0277/E0308 in bridge `src/screenshot/windows.rs:57–59`, passing incompatible COM types to `CapturePreview`. [x64 failure](https://github.com/Razee4315/Paperling/actions/runs/36972846093/job/110730292766), [ARM failure](https://github.com/Razee4315/Paperling/actions/runs/36972846093/job/110730292749). Linux, macOS, Android, Nix and security checks passed; those do not validate the Windows dependency graph.

Concrete fix: retain the compatible Tauri/Wry stack, or update the bridge and application Windows dependencies together. Require both Windows CI jobs before acceptance. No local Rust compilation was attempted.

## PR #249 — duplicate editor dependencies (P1), mismatched math renderer (P2)

[PR](https://github.com/Razee4315/Paperling/pull/249), head `7a66fcf06872f06e9b14bcba2daf026d7915d67b`.

PR `bun.lock:1294,1296` installs nested search dependencies `@codemirror/state@6.7.5` and `view@6.43.7`, alongside root `state@6.7.6` / `view@6.43.13`:

```text
@codemirror/search/@codemirror/state  6.7.5
@codemirror/search/@codemirror/view   6.43.7
```

CI fails on incompatible private `SelectionRange.flags` and missing `EditorView.clearAnnouncement`, including `src/components/CodeEditor.tsx:489,525,538,550,687,1029,1324,1327`. This prevents building the editor. [Desktop CI](https://github.com/Razee4315/Paperling/actions/runs/36491481698), [Android failure](https://github.com/Razee4315/Paperling/actions/runs/36491480696/job/109160869518).

Concrete fix: align CodeMirror overrides and regenerate/deduplicate the lockfile. Verify typechecking, full tests, editor search and selection after resolving the graph.

Separately, PR `bun.lock:836` has root `katex@0.18.9`, while `:1380` retains `rehype-katex/katex@0.16.45`. `src/components/MarkdownPreview.tsx:229–231` loads the renderer from rehype-katex, but the chemistry extension and CSS from root KaTeX. That registers the extension on a different instance. This secondary compatibility finding is based on the imports/lockfile, not a live PR reproduction. Keep a compatible single KaTeX version, or migrate renderer, extension and CSS together; verify equations and chemistry before merging.

## PR #246 — unsupported checker/compiler combination (P1)

[PR](https://github.com/Razee4315/Paperling/pull/246), head `71d0ede911c395dc54854392128a87f5acf05a68`.

`docs/package.json:35` changes to `"typescript": "~7.0.2"`. [Website CI](https://github.com/Razee4315/Paperling/actions/runs/36491324647/job/109160357692) fails from `@astrojs/language-server/dist/check.js:184`, explicitly reporting that TypeScript 7 lacks the programmatic API required by this Astro checker. The docs validation pipeline cannot run. Retain a supported compiler until the checker supports the replacement; do not bypass the check.

## PR #244 — Astro/Vite major versions conflict (P1)

[PR](https://github.com/Razee4315/Paperling/pull/244), head `306a274afbd8a82b3b31d3678d00a193e391cb37`.

Astro 7.3.5 requests Vite `^8.0.13`, but `docs/package.json:27` retains:

```json
"vite": "^7.3.2"
```

The override resolves Vite 7.3.6. [Website CI](https://github.com/Razee4315/Paperling/actions/runs/36491304547/job/109160280124) passes diagnostics for 33 files and five tests, then fails production generation with `rollupOptions.input should not be an html file when building for SSR`. Update/remove the incompatible override, regenerate the docs lockfile, and rerun the complete website workflow including output verification. The override conflict is concrete; the repaired build still needs verification before claiming that it was the only cause.

## Green PRs

[#245](https://github.com/Razee4315/Paperling/pull/245), head `87535e90f0a7ab0ee1ad9d15845b67c45f93e597`: all reported checks pass. P2 maintenance concern at `docs/package.json:31`: `"@types/node": "^26"` while `.github/workflows/test-website.yml:24` and `deploy-docs.yml:51` use `node-version: 24`. This can let future code compile against unavailable APIs; no present runtime failure was demonstrated. Prefer keeping runtime and types aligned. [Website evidence](https://github.com/Razee4315/Paperling/actions/runs/36491313438/job/109160310070).

[#247](https://github.com/Razee4315/Paperling/pull/247), head `6183cd268a2ccc89bf896b89e411f6cf7d8d05d9`: only `setup-node@v6` to `@v7` in `.github/workflows/deploy-docs.yml:49` and `test-website.yml:22`; Node runtime remains 24. All checks pass; no blocker identified. [Website evidence](https://github.com/Razee4315/Paperling/actions/runs/36491392365/job/109160574520).

All PRs except #260 report base `0126648628fcfd8e5260a1cfa59c62bf44e09350`; #260 reports `b6376e3823c8df3a8c44d51598610aa2cdf94a39`. Their principal upgrades are absent from current main. Green historical runs do not validate a new merge with current main: refresh/recheck before merging.

## Local verification and limits

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed on main's source.
- Default-worker full suite: 689 passed, three failed (bundle scan timeout, DOCX conversion timeout, live-preview assertion). All three files then passed individually with one worker: 20 tests.
- Complete rerun: `node node_modules/vitest/vitest.mjs run --maxWorkers=1` passed **73 files / 692 tests** in 48.71 seconds. The initial failures were not reproduced serially; their root cause has not been established.
- Browser: real frontend at port 5194 with the existing fake Tauri backend and Mac platform override; inspected screenshot and command dispatch. Native macOS behavior remains unverified.
- PR validation uses the actual GitHub CI logs at the recorded heads, not local production builds or a claim that each PR was checked out locally.
- No production build ran locally. Per the repository hand-off workflow, Windows Test Build [37209686092](https://github.com/Razee4315/Paperling/actions/runs/37209686092) was dispatched on review commit `9a63121`. It produced [paperling-windows-x64-test](https://github.com/Razee4315/Paperling/actions/runs/37209686092/artifacts/11305959855), expiring **2026-10-18 14:43 UTC**. It contains unchanged main application code plus the review documents, not fixes for the issues or upgrades from the reviewed PRs. macOS was not requested and was skipped.

The Windows Test Build completed successfully. Its downloadable artifact contains the MSI/EXE/portable test packages; it is not a release and does not update the updater manifest.

## Existing strengths and order of work

Preserve the strict raw-HTML then sanitization pipeline (`MarkdownPreview.tsx:1197–1198`), atomic save protections (`src-tauri/src/commands.rs:109–136`), and centralized shortcut configuration. The existing fake backend makes frontend/native-command routing reproducible without real file writes.

Recommended order: (1) refresh/check #247; (2) address the small docs compiler/override blockers and align Node types; (3) repair editor and Windows dependency graphs with platform CI; (4) implement and natively verify #262; (5) publish package channels in independent, testable stages.

Relevant table-stakes gaps compared with established desktop Markdown editors: native platform fullscreen affordances (medium impact), discoverable package-manager install/update channels (medium impact), and the previously documented limits of Reader editing compared with Typora-style full rich editing. This was an issue/PR-focused review, not a fresh exhaustive competitor audit.
