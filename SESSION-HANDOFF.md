# Paperling session hand-off — 2026-10-05

## Where we left off

We reviewed seven open PRs, reproduced file-safety failures in the new live-reload PR, and merged only the PR with no outstanding concerns. **PR #247 is on main. Six PRs remain open.** No application fixes or releases were shipped during this session.

## Done and verified

- Merged [PR #247 — actions/setup-node v7](https://github.com/Razee4315/Paperling/pull/247) into `main` as `7eeaa9f36b280d42af58c94738d7b394d0789dfc` on October 5 at 18:09 UTC. The change updates two website workflows; their Node runtime stays at 24.
- Fresh [CI on the merged commit](https://github.com/Razee4315/Paperling/actions/runs/37353878686) passed Windows x64, Windows ARM, macOS, Linux, cargo-deny and security scanning. The [website build and deployment](https://github.com/Razee4315/Paperling/actions/runs/37353877817) also passed.
- Reviewed all seven PR diffs and relevant CI evidence. The six dependency PR heads were unchanged from the October 4 review.
- Installed PR #263 at `ed2fce60ea9634bd25845624ec03d4dc409bc178` in an isolated worktree. Typechecking passed; its existing suite passed **698 tests**, with two production-bundle tests skipped because that worktree has no local `dist`.
- Added three temporary race reproductions for #263. **All three failed twice.** A real browser session with the development fake disk also confirmed that typing during a pending reload can be silently discarded. Ordinary clean reload, an already-dirty conflict, and desktop Move left worked.
- The [Windows Test Build for #263](https://github.com/Razee4315/Paperling/actions/runs/37314535285) passed. Its [MSI/EXE/portable ZIP artifact](https://github.com/Razee4315/Paperling/actions/runs/37314535285/artifacts/11347073311) expires **2026-10-19 13:19 UTC**. This is the reviewed, unsafe #263 code, not a repaired build. Use disposable files if testing it. Native macOS behavior was not independently tested by us.
- Committed the detailed report, screenshots, reproduction source/output and manual checklist as `5f2616771cfd29c75df58014349070c2c63115b1` on `fix/pr-review-2026-10-05` and pushed it.
- Before committing this hand-off, typechecking passed and the full main-source suite passed **73 files / 692 tests** with `--maxWorkers=1 --testTimeout=20000`. The first run's existing local bundle scan timed out at the default five seconds; the longer-timeout full rerun passed. No application code or test configuration changed.

## Remaining PRs and the decision for each

| PR | Current verdict | What must happen next |
|---|---|---|
| [#263 — tab drag and live reload](https://github.com/Razee4315/Paperling/pull/263) | **Hold: file safety failures.** | Preserve edits made while a read is pending; prevent in-flight autosave from writing after an external conflict; reject stale checks after a tab switch. Make the three reproductions permanent passing regressions. Recheck native tab dragging and real-file reloads afterward. |
| [#260 — Rust dependency group](https://github.com/Razee4315/Paperling/pull/260) | **Hold: Windows compilation fails.** | Align Tauri/Wry, the MCP bridge and direct Windows COM dependencies. Require both Windows x64 and ARM CI to pass. |
| [#249 — frontend dependency group](https://github.com/Razee4315/Paperling/pull/249) | **Hold: frontend compilation fails.** | Align/deduplicate CodeMirror packages and regenerate the lockfile. Also align KaTeX renderer, chemistry extension and CSS. Verify desktop/Android builds and live editor/math behavior. |
| [#246 — docs TypeScript 7](https://github.com/Razee4315/Paperling/pull/246) | **Hold: Astro checker fails.** | Keep a compiler supported by the docs checker, or upgrade the checker compatibly. Require the complete website workflow. |
| [#244 — Astro 7](https://github.com/Razee4315/Paperling/pull/244) | **Hold: website build fails.** | Remove/update the Vite 7 override that conflicts with Astro 7's Vite 8 requirement; regenerate the docs lockfile and verify the complete website workflow. |
| [#245 — docs Node 26 types](https://github.com/Razee4315/Paperling/pull/245) | **Checks pass; left open for alignment.** | Prefer Node 24 types to match the Node 24 build/deploy runtime. This is a maintenance concern, not a reproduced current runtime failure. It was not merged. |

For #263, the unsafe asynchronous behavior existed in the old focus-triggered paths. Its new 1.5-second polling makes those races possible during ordinary continuous editing, without a focus event. Do not describe every affected load/save line as newly introduced by the PR.

## Evidence and how to resume

- [Detailed PR report](https://github.com/Razee4315/Paperling/blob/5f2616771cfd29c75df58014349070c2c63115b1/PR-REVIEW-2026-10-05.md): exact file/line references, snippets, reproductions and proposed repairs.
- [Manual verification checklist](https://github.com/Razee4315/Paperling/blob/5f2616771cfd29c75df58014349070c2c63115b1/TEST-CHECKLIST.md).
- [Race-test source](https://github.com/Razee4315/Paperling/blob/5f2616771cfd29c75df58014349070c2c63115b1/review-evidence/pr263.reload-race.test.ts.txt) and [failure output](https://github.com/Razee4315/Paperling/blob/5f2616771cfd29c75df58014349070c2c63115b1/review-evidence/pr263-race-results.txt). The source is stored as `.txt` outside normal test discovery. Copy it to `src/hooks/pr263.reload-race.review.test.ts` to run it; the tests expect safe behavior and fail on the reviewed head.
- Local review worktree: `C:/Users/Saqlain/Desktop/Other/Paperling-pr263-review`. It contains the full report and evidence.
- This hand-off lives in the normal repo on `fix/pr-review-handoff-2026-10-05`, created from main **after** merging #247. It adds only this document.

**Do not merge the whole `fix/pr-review-2026-10-05` branch to main:** it contains #263's rejected application changes as its base. Its purpose was to build/test the exact PR code and preserve review evidence. Start fixes from current main or intentionally from the relevant PR, and bring over only the needed evidence/tests.

Next session: read this note and the detailed report, fetch current main, and recheck each PR head before assuming these findings still apply. Prioritize #263's file-safety races, then small docs compatibility repairs, then the broader frontend/Windows dependency updates. Follow the normal branch, regression-test, live-verification and CI workflow. This session did not authorize merging the remaining unsafe PRs.
