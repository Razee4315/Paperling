| Priority | Finding | Type / effort | Outcome |
|---|---|---|---|
| P1 | HOT-07: opening a background note during recovery could drop its older unsaved draft | Recovery / medium | Fixed; live collision preserves both versions and focus. |
| P1 | HOT-08: editing the first note during slow launch was not backed up | Recovery / medium | Fixed; live inspection sees new work and pending backups before background reads finish. Published tabs now own save/discard decisions. |
| P1 | Android imports with identical display names share one working cache file | Native data safety / medium | **Deferred, still present.** Needs native compilation and device verification. |
| P2 | AI-09: failed/stopped retries after a token replaced completed conversation history | AI / small | Fixed; live Regenerate, edited prompts and Stop retain the original transcript. |
| P2 | PANEL-02: Files/Outline steal editor focus after the first typed character | Editing / small | Fixed; continuous Code and Reader typing works with both docks open. |
| P2 | FILES-09: Go Up from `/home` or `C:/child` loses the filesystem root | Navigation / small | Fixed pure helper; normal workspace navigation verified live, filesystem-root edges reviewed in code. |
| P3 | PDF export staging survives failures before WebView creation | Native cleanup / small | **Deferred, still present.** Needs compiled error-path verification. |

# Previous-fix recheck — 2026-10-01

Scope: all 18 issues covered by [the original report](GITHUB-ISSUES-REPORT.md), plus READ-03 Reader editing on the same branch, `fix/github-issues-2026-09-30`. Review: [PR #255](https://github.com/Razee4315/Paperling/pull/255).

Five frontend defects were found and fixed. This is **not an all-platform certification**: the Android same-name cache collision remains a data-safety concern, native PDF failure cleanup remains incomplete, and package publication is still outstanding.

## How this was verified

The real React app ran on Vite port 5279. Browser verification used the existing development virtual filesystem, with explicit visible fixture controls for deterministic AI streams and a held background recovery read. These controls are development-only; they do not access the owner's real notes or a real model endpoint. Desktop and a separate-origin phone shell (`?mobile=1`, 390 × 780) were checked. Desktop docks were also measured at 600 × 720.

TypeScript `node node_modules/typescript/bin/tsc --noEmit` passed after the changes. Regression cases were added for recovery, AI retry rollback, panel focus, and parent-directory boundaries, but **were not executed**. The owner's explicit restriction overrides the repository's normal suite/build workflow: no test suite, production build, Rust/Android build, or manually dispatched GitHub Action ran during this recheck. A real 65-second pause between AI tokens was allowed to complete in the browser.

## Coverage of every previous issue

| Issue | Recheck evidence | Result / limit |
|---|---|---|
| #206 desktop shell / Zen | Desktop controls visible; F9 enters Zen with controls initially visible, idle hides the bar, F9 restores Code. Platform and drag handlers audited. | Browser shell passes; actual touch-enabled desktop dragging remains a native check. |
| #241 narrow controls | At 600px Close lies inside the viewport; two 140px docks leave 320px for the document. | Live pass. [Proof](docs/issue-proof/recheck-narrow-docks.png). |
| #232 dark mode pill | Dark/Graphite checked live; shared theme variables and mode styles reviewed for remaining themes. | Live pass for exercised themes; remaining themes code-reviewed. |
| #225 Files stays open | Desktop selection and uppercase `.MD` creation preserve Files; mobile selection closes it. Sustained typing exposed PANEL-02. | Fixed and live pass. |
| #226 simultaneous docks | Files left, Outline right, both present during full Code and Reader typing. Mobile Files replaces Outline as one sheet. | Fixed focus regression and live pass. [Proof](docs/issue-proof/recheck-panel-typing.png), [phone Files](docs/issue-proof/recheck-mobile-files.png). |
| #227 folder workspace | Open folder, enter child, Go Up, drop Projects, switch outside workspace, reload, and Find in Files (`Ship`, one Roadmap match) exercised. | Live pass. FILES-09 root boundaries corrected in code. |
| #228 startup / recovery | With reopening off, clean saved note did not reopen but dirty buffers did. Held-background launch allowed editing A, separately opening/editing B, inspecting backups before release, and reopening after recovery. Separate held launches exercised explicit Discard and Save As. | HOT-07/HOT-08 fixed; both distinct B versions retained, new A/B work recovered, discarded A stayed absent, renamed A stayed selected and Saved without resurrecting its old path. [Proof](docs/issue-proof/recheck-recovery-copy.png). |
| #224 HTTPS images | With remote loading off no image element; per-image opt-in loads HTTPS. Global opt-in loads the badge (`naturalWidth=48`); HTTP stays rejected. | Live pass. [Proof](docs/issue-proof/recheck-images.png). |
| #229 editor AI streaming | Expand shows first tokens, waits through 65 seconds without a new token, then completes; Replace and Code Undo work. Separate Stop makes controls available without applying text. | Live frontend pass. [Proof](docs/issue-proof/recheck-ai-long-stream.png). Native transport reviewed, actual local model not exercised. |
| #230 prompt edit / Regenerate | Retry fails after partial output; edited early prompt fails with later turns present; Stop during retry; successful edited prompt truncates later turns; close/reopen retains completed revision. | AI-09 fixed and live pass. [Proof](docs/issue-proof/recheck-ai-retry.png). New Chat/session switching rollback also covered by code review/regression source. |
| #231 Agent edits | Prose response produces warning and explicit full-reply diff; Reject keeps source. Valid SEARCH/REPLACE accepts, Undo restores. Changing note during slow request prevents stale proposal. Unique/ambiguous matching audited. | Live pass for review/apply/staleness; whitespace/ambiguity boundaries reviewed in existing tests and code. |
| #213 / READ-03 Reader editing | Previous detailed Reader verification remains recorded in checklist; this recheck types a complete suffix with both docks open, Done retains it, Reader Undo restores it. Switching to Code preserves frontmatter, inline code, Mermaid and footnotes. | PANEL-02 fixed and live pass; settings now accurately says “Click”. Specialized blocks retain their Code editing path. |
| #250 macOS Finder opening | Boot pull + warm event queue/handshake inspected. | Code review only; no macOS runtime available. |
| #252 Android caret / IME | Insets, resize/measurement and focused-caret scheduling inspected; phone shell layout exercised. | Actual software keyboard, rotation and caret occlusion require a device. |
| #253 Android Downloads | UI-thread origin validation, off-thread writes, request IDs and callback lifecycle inspected. | Device writes unverified; same-name cache collision remains (below). |
| #254 Android picker | Mobile **Open from device…** without a native bridge displays “System file picker isn't available in this build”. Native picker and callbacks inspected. | Browser error path passes; real picker/import/cancellation requires a device. |
| #214 PDF temp cleanup | Normal-path bounded background cleanup inspected. | Native runtime unverified; early failure still leaks staged HTML (below). |
| #212 packaging | Pinned Nix input/dependency configuration and Scoop/Homebrew digest changes reviewed. | Runtime installation was not run; publication/signing/hosting remains owner-controlled and outstanding. |

## Defects corrected in this recheck

### HOT-07 — pending recovery collided with a live tab (P1)

Evidence: `src/hooks/useFileSession.ts:1252`. The old final merge filtered every recovered tab whose path was already open. Opening a background file before its restore read completed therefore discarded a distinct crashed draft; the next backup write erased its remaining recovery record.

```ts
if (tab.content === tab.originalContent || tab.content === existing.content) return [];
return [{ ...tab, filePath: null, fileName: `Recovered ${tab.fileName}`, knownMtime: 0 }];
```

The live tab keeps focus and its text. A different dirty recovered version becomes an unsaved untitled recovery tab, with no target that can overwrite the live file. Equal content does not duplicate. Live verification opened and edited B while restore waited, released it, inspected the recovered copy, and reloaded successfully.

### HOT-08 — new work was unprotected during background loading (P1)

Evidence: `src/hooks/useFileSession.ts:145`, `:1053`, `:1078`, `:1179`, `:1224`. The old backup effect returned while `booting`, even though the first tab was already editable. A crash while another read stalled could lose all newly typed text. Removing that guard alone would erase unread backups or resurrect a published tab after explicit discard.

```ts
saveBufferBackups([...pending, ...liveBackups]);
loaded = loaded.filter((tab) => !publishedIds.has(tab.id));
```

Capture pending records before asynchronous startup work; combine them with new live backups during loading. Distinct versions of one path also receive separate storage identities. Published tabs own their normal save/discard lifecycle and are excluded from stale final snapshots. The visible backup inspector confirmed protection before the held read was released. Live Discard removed the first note from backups and final tabs; live Save As retained its new path, content, selection and Saved state without reviving the old path. Discard and duplicate-content boundaries have regression cases written; those cases were not run. Existing backup size/count limits remain in force.

### AI-09 — partial replacement erased a completed conversation (P2)

Evidence: `src/components/AIPanel.tsx:129`, `:209`, `:277`, `:291`. Old failure handling preserved a partial response whenever any token arrived, including destructive Regenerate/edited-prompt requests. A disconnect or Stop could replace a full answer and remove later turns.

```ts
replacementTranscriptRef.current = replacingTranscript ? messages : null;
if (replacingTranscript) restoreTranscript();
```

Replacement requests now retain the original transcript until successful completion; failure/cancellation restores it, including the edited composer. New questions keep useful partial replies as before. New Chat and history switching store the original conversation if a replacement is unfinished. Live retry failure, edited-prompt failure, Stop, successful edit and close/reopen passed; four regression cases were added without executing them.

### PANEL-02 — open docks interrupted continuous typing (P2)

Evidence: `src/hooks/useSidePanel.ts:20`, `:40`. The focus effect depended on `onClose`. App's inline callback changed on each document update, restarting the effect and moving focus into the panel after the first character. This was reproduced with Reader and Files open.

```ts
closeRef.current = onClose;
// effect dependencies: [panelRef, isOpen]
```

Keep the latest callback in a ref and only attach panel focus handling when opening/closing. Capture the opener before moving focus into the panel so closing restores the correct focus. Full Reader and Code phrases now type without interruption with Files and Outline open. Two focused regression cases were added without running them.

### FILES-09 — parent traversal dropped filesystem roots (P2)

Evidence: `src/utils/documentPaths.ts:6`, used by `src/components/FileExplorer.tsx:67`. The old last-slash logic made `/home` produce no parent and `C:/child` produce drive-relative `C:`. The user could not reliably navigate to the filesystem root.

```ts
if (slash === 0) return "/";
if (slash === 2 && /^[a-z]:\//i.test(normalized)) return normalized.slice(0, 3);
```

Shared parent traversal preserves `/` and `C:/`, and stops at the root itself. Normal workspace child/root navigation passed live. Unix/drive-root boundaries have written regression cases and were reviewed; native filesystem-root browsing was not exercised.

## Remaining native findings — deferred

### Android same-name cache collision (P1, pre-existing)

Evidence: `scripts/patch-android-open-with.mjs:356-358` (picker), `:396-398` (Open-with), `:330-331` (Downloads mirror), and `src/hooks/useFileSession.ts:407-409` (path deduplication).

```kotlin
val outFile = File(dir, safe)
outFile.outputStream().use { output -> input.copyTo(output) }
```

All documents with the same display name use `cache/open/<displayName>`. Opening `folderA/report.md` then `folderB/report.md` overwrites the same working file, while the frontend path deduplication can keep the first buffer visible. A copy failure can truncate that existing cache file. This undermines data safety independently of the repaired picker bridge.

Concrete fix: assign a distinct directory/identity per source URI or import; retain the display filename inside that directory, preserve duplicate-delivery deduplication, and copy into a unique temporary file before atomic publication. Verify two different same-name sources, repeat delivery of the same source, dirty buffers and a mid-copy failure on Android. **No native changes landed:** there is no local Rust/Android toolchain and this task forbids CI builds. Compilation/device verification is required before implementing and committing this native change.

Downloads is currently an exported snapshot; ordinary later Save/autosave writes its app-private working cache, not that shared snapshot. This is existing behavior and must be clear in device verification; this recheck does not claim continuous Downloads synchronization.

### PDF staging leaks on early failure (P3, pre-existing)

Evidence: `src-tauri/src/pdf.rs:95-96` and `:121-122`. After staging HTML, URL conversion and hidden-window construction use `?` before the cleanup worker is established.

```rust
let url = tauri::Url::from_file_path(&temp).map_err(...)?;
// ...
.build().map_err(...)?;
```

Normal export cleanup does not cover these error returns, leaving document HTML in Temp. Concrete fix: a scoped staging-file guard or explicit cleanup on every pre-window error, preserving the normal retry cleanup after WebView closure. Inject URL/window creation failure and inspect Temp in a compiled native run. Deferred for the same toolchain/build restriction; no uncompiled Rust edit was committed.

## What remains sound

The preview keeps `rehypeRaw` before strict sanitization, HTTPS privacy gating and unsafe URL rejection. Agent proposals retain document identity/text guards and require review. Recovery copies have no overwrite path. Atomic save/conflict protection and theme architecture were retained. No API keys were logged, release cut, version bumped, issue closed, or package repository published.

Large-document performance was not benchmarked in this pass. Native touch dragging, Finder delivery, Android IME/import/Downloads, installer behavior and PDF filesystem cleanup remain explicit verification limits, not inferred passes from a browser fixture.

Recommended order: native Android import identity/atomic copying first, then compiled PDF error-path cleanup, then the device/platform checklist and packaging installation/publication. The frontend regressions corrected here have live proof and TypeScript validation; their written automated cases await a permitted test run.
