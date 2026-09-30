| Priority | Issue | Type / effort | Outcome |
|---|---|---|---|
| P1 | [#253 Downloads writes fail](https://github.com/Razee4315/Paperling/issues/253) | Native bug / medium | Fixed UI-thread bridge validation and off-thread IO; save results carry request IDs. Android CI and device checklist required. |
| P1 | [#254 Device picker does nothing](https://github.com/Razee4315/Paperling/issues/254) | Native bug / small | Fixed UI-thread WebView access, synchronous bridge failures and visible picker errors. |
| P1 | [#252 Keyboard hides the caret](https://github.com/Razee4315/Paperling/issues/252) | Native/editor bug / medium | Reserve IME space and remeasure/reveal the focused CodeMirror caret. Real phone confirmation remains manual. |
| P1 | [#206 Window cannot be moved/closed](https://github.com/Razee4315/Paperling/issues/206) | Shell bug / small | Touch-enabled Windows/Linux always receive the desktop shell and window controls; Zen touch controls remain reachable. |
| P1 | [#241 Narrow-window controls disappear](https://github.com/Razee4315/Paperling/issues/241) | Layout bug / small | Filename yields space before fixed window controls. Verified at 600px. |
| P1 | [#250 Finder opens the app but not the note](https://github.com/Razee4315/Paperling/issues/250) | Native launch bug / medium | Handle macOS open-document events before and after the frontend launch pull. |
| P1 | [#228 Session restore preference / slow launch](https://github.com/Razee4315/Paperling/issues/228) | Recovery/feature / medium | Preference defaults on; unsaved work always recovers. Requested note paints before background tabs. Missing-file backups become untitled buffers. |
| P2 | [#231 Agent silently does nothing](https://github.com/Razee4315/Paperling/issues/231) | AI bug / medium | Explain missing/failed edits, normalize safe whitespace differences, reject ambiguous matches and stale documents; offer an explicit replacement diff. |
| P2 | [#229 Editor AI times out after 60s](https://github.com/Razee4315/Paperling/issues/229) | AI bug / medium | Share streaming transport with chat: 120s header budget, no total generation deadline, token preview and Stop. |
| P2 | [#230 Edit messages / regenerate](https://github.com/Razee4315/Paperling/issues/230) | AI feature / medium | Edit any user prompt with Cancel; replace later turns on Send; regenerate latest reply using current note context. Preserve the prior answer on a failed retry. |
| P2 | [#224 HTTPS images do not render](https://github.com/Razee4315/Paperling/issues/224) | Preview/CSP bug / small | HTTPS-only image CSP, privacy toggle and per-image opt-in. Sanitization order retained. |
| P2 | [#225 Files closes on selection](https://github.com/Razee4315/Paperling/issues/225) | UX feature / small | Desktop Files stays open on selection/create; mobile sheet still closes. |
| P2 | [#226 Files and Outline together](https://github.com/Razee4315/Paperling/issues/226) | Layout feature / medium | Files left, Outline/Backlinks right; AI swaps the right dock. Responsive widths preserve a usable center. |
| P2 | [#227 Open folder / folder drop](https://github.com/Razee4315/Paperling/issues/227) | Workspace feature / medium | Folder dialog, palette command, folder drops, persistent explorer root and workspace search. Text-file suffixes are shared and case-insensitive. |
| P2 | [#213 Optional Reader editing](https://github.com/Razee4315/Paperling/issues/213) | Editing feature / large | Implemented for rendered paragraphs, headings, ordinary lists and quotes, including inline formatting. Specialized Markdown stays in Code; this is not a full Typora-style rich document editor. |
| P2 | [#212 Package repositories](https://github.com/Razee4315/Paperling/issues/212) | Distribution / large | Repaired stale Nix version/dependency hash and pinned inputs. Verified Scoop/Homebrew release digests. **Publication is still outstanding**; apt signing/hosting and F-Droid distribution require owner-controlled setup. |
| P3 | [#214 Export HTML remains in Temp](https://github.com/Razee4315/Paperling/issues/214) | Native cleanup bug / small | Retry bounded cleanup off the UI thread after closing the export WebView; log exhaustion rather than silently ignoring it. |
| P3 | [#232 White mode pill in dark themes](https://github.com/Razee4315/Paperling/issues/232) | Theme polish / small | Active pill uses theme hover surface and text, with an accent ring. |

# GitHub issue verification — 2026-09-30

All **18 open issues** were read, including available comments and relevant existing PRs. Work is on one branch, `fix/github-issues-2026-09-30`, starting from `origin/main` (`0126648`). Review: [PR #255](https://github.com/Razee4315/Paperling/pull/255). No issues were closed and no public issue comments were posted.

The owner's explicit request overrides the normal full-suite requirement: **no full suite and no production build ran locally**. Local Vitest runs selected files with `--maxWorkers=1`; TypeScript ran without emitting output. Frontend verification used the real app at Vite port 5279, with the existing development virtual-disk backend and visible fixture controls. It does not establish native window dragging, Android picker/Downloads behavior, macOS Finder delivery, or Windows temp-file release timing. Those have CI compilation/tests and the device checklist below.

## Findings and fixes

### #206 — touch-enabled desktop incorrectly receives the phone shell (P1)

Evidence: `src/utils/platform.ts:42` and `:59`. Generic `maxTouchPoints > 1 && coarsePointer` classification hid the desktop title bar on Windows convertible devices, even with a connected mouse. This makes a frameless app impossible to move or close using normal controls. The comments on the issue establish that the earlier Zen-only diagnosis did not cover this case.

```ts
if (/windows nt|x11|linux/i.test(ua)) return false;
```

Applied the verified approach from [PR #243](https://github.com/Razee4315/Paperling/pull/243), including touch-safe Zen controls. Pure platform tests cover Windows/Linux touch signals and Android/iPad exceptions. Window/Zen tests cover control and drag handlers. Native dragging still needs the installer check.

### #241 / #232 — compact controls and theme surface (P1 / P3)

Evidence: `src/components/TitleBar.tsx:126` and `:215`; `src/components/ModeToggle.tsx:31`. The left title/actions region could consume the fixed controls' space. A solid `--accent` fill is white in several dark themes, making the active mode look glaring.

```tsx
<div className="flex flex-1 min-w-0 ...">
// Active mode: bg-[var(--bg-hover)] text-[var(--text-primary)] ring-1
```

The flexible title yields first; control/action icons do not shrink away. The active mode now uses the theme's hover surface. At 600px the Close control stayed inside the viewport. [Screenshot](docs/issue-proof/window-controls-dark.png). Mode-toggle and theme checks passed.

### #225 — explorer closes when selecting or creating a note (P2)

Evidence: `src/components/FileExplorer.tsx:190` and `:241`. Unconditional `onClose()` made repeat desktop navigation unnecessarily reopen Files each time.

```ts
onFileSelect(path);
if (IS_MOBILE) onClose();
```

Desktop selection and note creation retain the panel; phone behavior remains a sheet. Desktop/mobile regression tests and the real selection flow passed. [Screenshot](docs/issue-proof/files-stay-open.png).

### #226 / #227 — independent docks and a persistent folder workspace (P2)

Evidence: `src/App.tsx:242`, `:868`, `:1174`, `:1520`, `:2325`; `src/components/FileExplorer.tsx:85` and `:246`; `src/utils/documentPaths.ts:3`; `src-tauri/src/commands.rs:434`. Mutual exclusion put Files and Outline in the same lane. File-only drop filtering and deriving the root solely from the active note prevented folder opening.

```ts
const directory = await open({ directory: true, multiple: false, title: "Open folder" });
if (info.is_dir) openWorkspace(path);
else if (isDocumentPath(path)) await loadFile(path);
```

Added folder entry points to the title bar, welcome screen, Files and command palette. Native drops inspect the existing metadata command, which now returns `is_dir`; no new Rust command was introduced. The chosen workspace is persisted and stays rooted when tabs point elsewhere; Go Up stops at the root and workspace search uses it. Boundary checks preserve Unix case sensitivity and Windows case folding.

Desktop Files occupies the left lane; Outline/Backlinks occupy the right lane and swap with AI. The phone keeps one full-screen sheet. At 600px each dock measured 140px, leaving 320px for the document. Rooted navigation/path tests and actual open-folder/drop/dual-panel flows passed. [Screenshot](docs/issue-proof/files-and-outline.png).

### #228 — preference, active-first launch and unconditional recovery (P1)

Evidence: `src/utils/persistence.ts:190`, `src/components/SettingsModal.tsx:552`, `src/hooks/useFileSession.ts:1134` and `:1177`. Clean tabs reopened unconditionally, and serial background reads delayed the note explicitly opened through the OS. Session reopening and unsaved-work recovery must be independent.

```ts
const session = reopenSession ? getSession() : null;
const readOrder = activePath ? [activePath, ...paths.filter((p) => p !== activePath)] : paths;
// HOT-06: missing/unreadable saved files recover their backups as untitled buffers.
```

The launch preference defaults on. The requested/active note is published first, then a frame is allowed before background IO. Original tab order is restored afterwards, and edits made during restoration are merged from live state. Persistence remains gated until unread recovery records have been consumed. Unsaved buffers recover even with reopening off; a missing file's draft is recovered without targeting a nonexistent path for overwrite.

Tests hold a background read unresolved and verify the requested note is already usable, edits survive the final merge, and disabled reopening/missing-file recovery keep backups. Live reload verified disabled clean-tab restoration and unsaved recovery. [Screenshot](docs/issue-proof/session-recovery.png).

### #224 — CSP blocks HTTPS images (P2)

Evidence: `src-tauri/tauri.conf.json:30`; `src/components/MarkdownPreview.tsx:409`; `src/components/SettingsModal.tsx:560`. The image loader accepted remote sources, but native CSP omitted HTTPS.

```text
img-src 'self' blob: data: https:
```

HTTPS images/badges now work. A persisted toggle explains that remote hosts see the user's IP; disabled loading creates no `<img>` request until the specific image is approved. Plain HTTP stays outside the native image policy. The `rehypeRaw → rehypeSanitize` order and strict schema remain intact. CSP/loader tests passed; a real HTTPS badge loaded with `naturalWidth=88`, and the disabled/individual-approval flow was exercised. [Loaded](docs/issue-proof/https-image.png), [opt-in](docs/issue-proof/remote-image-opt-in.png).

### #229 — editor action has an inappropriate total deadline (P2)

Evidence: `src/utils/aiAssist.ts:15`, `src/utils/aiChat.ts:87` and `src/components/AIBubble.tsx`. The original non-streaming action set both connect and total deadlines to 60 seconds, so a functioning local model's long generation was cut off.

```ts
await streamChat(messages, cfg, { signal, onToken, temperature: 0.7 });
// connectTimeoutMs: 120_000; no totalTimeoutMs
```

Editor actions share chat's streaming client and common endpoint/key guards. Tokens preview as they arrive; Stop cancels the request; insertion waits until generation stops. Non-streaming compatible responses still work. Targeted transport/action/bubble tests and live streaming/Stop passed. [Screenshot](docs/issue-proof/editor-ai-streaming.png). Real hardware-dependent model speed remains a manual check.

### #230 — sent prompts cannot be edited and replies cannot be regenerated (P2)

Evidence: `src/components/AIPanel.tsx:114`, `:474`, `:475`. Previously the panel only appended new turns. Added Edit to each user turn, staging changes in the composer with Cancel. Send replaces that prompt and subsequent replies; cancellation preserves both history and the previous draft. Regenerate reuses the latest question with history before that question, preventing duplication, and attaches fresh document/selection context.

```ts
const prior = retry?.history ?? (editingIndex == null ? messages : messages.slice(0, editingIndex));
```

Retries discard pending document proposals. Old-chat tokens/completions are ignored after switching, clearing or closing. A failed retry before any tokens restores the previous transcript instead of losing the existing answer. Revised history persists. Regression tests cover truncation, Cancel, fresh request history, late callbacks and failed regeneration. Live Edit, Send and Regenerate passed. [Screenshot](docs/issue-proof/ai-message-edit.png).

### #231 — no edits look successful and literal matching is brittle (P2)

Evidence: `src/utils/aiChat.ts:237` and `:248`; `src/components/AIPanel.tsx:187`. Earlier code selected the first literal occurrence and treated a response without edit blocks as an ordinary answer, with no explanation that the document was unchanged.

```ts
const range = uniqueEditRange(doc, search);
if (!range) { failed++; continue; }
```

Searches must match uniquely. A conservative fallback tolerates CRLF/LF and trailing horizontal whitespace while mapping back to original source offsets; prose differences, ambiguous duplicates and empty searches fail safely. No arbitrary fuzzy rewrite occurs. The panel explains missing/failed edits; a user may explicitly choose **Review full reply as replacement document**, which opens the existing Accept/Reject diff. Requests whose document text or tab identity changed cannot propose edits. Empty replies produce an error instead of an endless Thinking bubble. Tests cover these guards; live fallback opened a diff and Reject left the original unchanged. [Screenshot](docs/issue-proof/agent-no-edits.png).

### #213 — optional editing of rendered text (P2; scoped implementation)

Evidence: `src/utils/readerEdits.ts:8`, `src/components/MarkdownPreview.tsx:896` and `src/components/SettingsModal.tsx:572`. Reader previously had source-writing task/frontmatter controls but no text editing. A whole-document HTML round trip would erase unsupported Markdown, so that approach was rejected.

```ts
if (document.slice(range.start, range.end) !== range.source) return null;
return document.slice(0, range.start) + replacement + document.slice(range.end);
```

Enable **Edit Reader**, then double-click a paragraph, heading, ordinary list or quote (or focus it and press Enter). Type in the rendered block, use Bold/Italic/Strike and native Undo/Redo, and finish with Done or Escape. **Every input writes through the existing file-session state**, so a mode/tab switch does not leave a separate unprotected draft. Undo block changes restores the original block only while the source is still current. Pasted HTML is not injected; paste inserts plain text.

Only the selected, source-addressed block is serialized. All surrounding bytes, frontmatter and line endings stay intact. Comments, math, diagrams, images, tables, tasks, callouts, custom IDs, note links/tags, and other specialized syntax remain in Code; attempting to edit them explains this limitation. Nested diagrams/tables are protected too. The preview stays stable while typing, then updates source anchors and heading IDs when editing ends. This satisfies optional direct editing for text blocks; full rich table/media/extension editing remains an explicit gap.

Focused tests cover repeated input without remounting, duplicate paragraphs, CRLF, surrounding syntax, stale/tab changes, empty deletion and block rollback. Live typing and bold formatting preserved frontmatter and Mermaid source, without Split. [Screenshot](docs/issue-proof/reader-editing.png). Browser editing commands retain native undo history; their deprecated status and platform limitations are documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand). Native WebView formatting should be confirmed with the checklist.

### #250 — Finder sends an event, not an argv file (P1)

Evidence: `src-tauri/src/lib.rs:54`, `:79`, `:221`. macOS Finder uses open-document events; the old argv/single-instance path did not receive them. Applied the verified implementation from [PR #251](https://github.com/Razee4315/Paperling/pull/251).

```rust
if let tauri::RunEvent::Opened { urls } = _event {
    if let Some(path) = md_url(&urls) { open_os_file(_app, path); }
}
```

A mutex-protected handshake stashes cold-start files until the frontend pulls and forwards later events to the existing listener. File URLs are decoded; non-file URLs are rejected. Rust tests cover cold/warm ordering and macOS URL decoding. Existing PR CI and branch CI compile-check the platform-specific path. Cold/warm Finder delivery needs macOS manual confirmation.

### #214 — WebView2 retains the temp handle briefly after close (P3)

Evidence: `src-tauri/src/pdf.rs:198` and `:208`. `close()` is asynchronous; one ignored `remove_file()` failure leaves exported content in Temp. The retry approach comes from [PR #215](https://github.com/Razee4315/Paperling/pull/215); unrelated lockfile changes were excluded.

```rust
std::thread::spawn(move || retry_temp_cleanup(/* remove */, /* wait */));
```

Cleanup retries up to 20 times at 100ms intervals off the UI thread. Already-removed files count as success; exhausted failures are reported. Unit tests simulate a briefly locked file, NotFound and persistent failure. CI caught and fixed test-module placement under Clippy before handoff. Actual Windows/macOS export cleanup remains a native checklist item; a permanently locked file cannot be guaranteed removable.

### #252 / #253 / #254 — Android IME and JavaScript bridge threads (P1)

Evidence: `scripts/patch-android-open-with.mjs:115`, `:227`, `:243`; `src/hooks/useKeyboardInset.ts:42`; `src/components/CodeEditor.tsx:1220`; `src/utils/nativePicker.ts:81`. The insets handler consumed IME insets without reserving their bottom area. JavaScriptInterface methods execute off the UI thread, but origin checks accessed `WebView.url` on that thread before launching the picker/save; this can throw before any visible action.

```kotlin
v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
runOnUiThread { if (isAppOrigin(findWebView(window.decorView))) { /* launch */ } }
```

Origin parsing checks exact allowed schemes/host; UI work stays on UI, Downloads writes run on a worker, and results return on UI. Picker errors produce a toast. JavaScript registers callbacks before invoking native methods and handles synchronous bridge exceptions/concurrent saves. Request IDs prevent late timed-out callbacks from acknowledging a different save. Resize events remeasure CodeMirror and reveal the focused caret; the generic keyboard inset avoids scrolling the whole editor node.

Generated-template tests run the patch twice and verify idempotence, IME reservation and UI-thread methods. Picker/save tests cover synchronous errors/callbacks, timeout, concurrency and stale results. Android CI validates generated Kotlin; physical keyboard/picker/Downloads behavior remains manual. No local Rust or Android toolchain was installed.

### #212 — prepared manifests are not published repositories (P2; outstanding external work)

Evidence: `packaging/scoop/paperling.json:9`, `packaging/homebrew/paperling.rb:7`, `flake.nix:21` and `:28`, `.github/workflows/nix-build.yml:18`. Scoop/Homebrew hashes were compared to GitHub's published v1.0.51 asset digests and match. No owner `scoop-bucket`/`homebrew-tap` existed during the audit. The last two Nix runs failed with a stale frontend closure hash; the flake also reported 1.0.49.

```nix
version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
x86_64-linux = "sha256-EO4Qx8J7XVWUEDhRlGVd+LPdXboT7R6MMO9xojPRN2E=";
```

The new digest comes from branch CI's fixed-output derivation, not a guessed hash. Upstream inputs now pin exact revisions. Nix advertises only x86_64 Linux, whose closure is pinned; CI covers frontend/Cargo/version changes and cancels superseded builds. Full Nix package verification is tracked below.

**#212 cannot honestly be marked fully delivered:** publishing Scoop/Homebrew requires a selected owner repository or upstream submission; apt requires a signing identity and repository host; F-Droid requires its reviewed source recipe and distribution process. The repo explicitly keeps releases owner-triggered. No release, signing identity, external registry repository, version bump, or updater manifest was created. The verified manifests and precise publication playbook are in [packaging/README.md](packaging/README.md).

## Verification record

| Local batch | Tests selected | Result |
|---|---|---|
| Shell/theme | platform, ZenTopBar, TitleBar, ModeToggle, FileExplorer, theme contrast | 51 passed |
| Android/caret | nativePicker, generated patch, CodeEditor, keyboard inset | 17 passed |
| Recovery/preview/workspace | file session, persistence, preview, explorer, document paths | 62 passed |
| AI | assist, chat, transport, sessions, panel, bubble | 73 passed |
| Reader | Reader source helpers, preview, persistence | 47 passed |
| Safety follow-ups | nativePicker + generated patch; AI panel | 7 passed in each batch |

Counts are per invocation and include overlap; they are not a unique-test total. TypeScript passed after the implementation batches. A final four-test explorer run passed after adding the mobile notes-root fixture. At 390px, the real mobile shell opened Files as a sheet and dismissed it on note selection ([proof](docs/issue-proof/mobile-files.png)). The fixture's initial missing `get_notes_dir` error was test-backend setup, not a production defect. Browser proofs are under `docs/issue-proof/`. No local full-suite run or local production build occurred. CI runs the full suite and native compilation on remote runners.

Production changes at `0c754c8` passed [CI](https://github.com/Razee4315/Paperling/actions/runs/36723662685) on Linux, macOS, Windows x64 and Windows ARM, [Android Test Build](https://github.com/Razee4315/Paperling/actions/runs/36723661638), [full x86_64 Linux Nix build](https://github.com/Razee4315/Paperling/actions/runs/36723661682), and [Test Website](https://github.com/Razee4315/Paperling/actions/runs/36723661822). The final [Test Build](https://github.com/Razee4315/Paperling/actions/runs/36725391322) succeeded. The only subsequent source change adds a development-only mobile test fixture, excluded from production. A transient Windows ARM full-suite timeout in an unrelated HTML export test passed on the subsequent CI run without altering assertions.

| Test Build artifact | Download | Expiry (UTC) |
|---|---|---|
| Windows x64 MSI, EXE and portable ZIP | [paperling-windows-x64-test](https://github.com/Razee4315/Paperling/actions/runs/36725391322/artifacts/11103255457) | 2026-10-14 14:01:44 |
| macOS universal DMG (Intel + Apple Silicon) | [paperling-macos-universal-test](https://github.com/Razee4315/Paperling/actions/runs/36725391322/artifacts/11103210619) | 2026-10-14 14:02:39 |

These are test artifacts with 14-day retention, not a release. They contain all production fixes in this report. Follow [TEST-CHECKLIST.md](TEST-CHECKLIST.md) for hardware checks that a browser/CI runner cannot establish.

## What already works well

Keep the strict raw-HTML sanitization pipeline, atomic/native file writes, conflict guards, per-tab recovery records, platform keybindings, incremental preview rendering, theme variables and Accept/Reject diff review. Existing file commands support the folder feature; no new unverified Rust IPC surface was needed. The virtual backend stays behind the development-only import and is excluded from production bundles.

## Remaining gaps and order of attack

1. Run the short native checks in [TEST-CHECKLIST.md](TEST-CHECKLIST.md): touch-enabled desktop controls, Android keyboard/picker/Downloads, cold/warm Finder open, and temp cleanup. CI proves compilation and regressions, not hardware behavior.
2. Publish the verified distribution manifests and choose apt/F-Droid ownership/signing infrastructure. #212 remains open for this work.
3. Extend Reader editing only with source-preserving models for tables, media and Paperling syntax. A whole-document HTML export/import remains inappropriate for a no-data-loss editor.
4. Rich editing, workspace navigation, accessible keyboard controls and safe launch/recovery were the comparison focus against Obsidian/Typora/VS Code/MarkText expectations. Package-manager publication and comprehensive rich-block editing remain the largest gaps from this issue set; plugin/sync systems were outside it.
