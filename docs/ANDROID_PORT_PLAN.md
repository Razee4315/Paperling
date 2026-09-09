# Paperling — Android Port Plan

Status: implementation plan for the `android-app` branch. Written after a full
codebase audit + the three shared Tauri-mobile guides (`TAURI_QUICK_SETUP.md`,
`tauri-android-lessons.md`, `tauri-cicd-pipeline.md`). Every decision below cites
why; every known gotcha from the lessons doc is either applied here or explicitly
rejected with a reason.

## 0. What the app is

Paperling is a Tauri 2 desktop markdown editor:

- **Frontend**: React 19 + TypeScript + Tailwind 4 + CodeMirror 6; a single
  desktop-shaped shell (`App.tsx`): custom frameless TitleBar (JS window
  dragging, min/max/close), TabBar with HTML5 drag reorder, editor/preview split,
  288 px fixed left drawers, 400 px AI side panel, desktop StatusBar, floating
  ModeToggle, keyboard-first command palette.
- **Backend** (`src-tauri`): file commands (`read_file`, `save_file` (atomic),
  `list_directory_files`, `search_files`, `find_backlinks`, image save/read),
  AI key in the OS keychain (keyring), AI HTTP transport through reqwest (SSE
  streaming over a Tauri Channel), silent PDF export via hidden WebView2/WKWebView.
  Updater/process/window-state/single-instance are desktop plugins (some already
  target-gated).

Good news found in the audit: the Rust side is **already largely mobile-aware**
(`lib.rs` uses `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, updater/process/
window-state are target-gated, capabilities are split `default.json`/`desktop.json`).

## 1. Verified facts (researched, not assumed)

| Fact | Consequence |
|---|---|
| `reqwest` 0.13 made **rustls + aws-lc-rs the default TLS** (`default-tls = ["rustls"]`); Cargo.lock has **no native-tls/openssl** anywhere | No TLS switching needed for Android cross-compile at all. Risk moves to aws-lc-sys needing cmake (present on GH runners). Fallback documented in §8. |
| `tauri-plugin-dialog` supports Android/iOS (open/save/message) **but returns Tauri `FilePath`**, which on Android is a URI-form identifier (SAF) | `std::fs`-based commands cannot read OS-picked files. **Mobile file model = app-private notes folder** (§3). Message dialogs (`ask`) stay used (create-note flow). |
| `keyring` v3 has no Android backend | AI key storage cfg-split: keyring on desktop, atomic file in app-data on mobile (§4). |
| Tauri Android IPC uses `ipc://localhost` / `http://ipc.localhost`; a strict CSP blocks it **silently** | `http://ipc.localhost` added to `default-src` + `connect-src` in the **base** tauri.conf.json (harmless on desktop). |
| Platform config merge is JSON Merge Patch; **arrays are replaced wholesale** | `tauri.android.conf.json` restates the whole `app.windows` array without desktop-only keys (`decorations:false`, `visible:false`, sizes). |
| Capability files are validated per platform | `default.json` gets desktop `platforms`; new `mobile.json` grants only mobile-safe permissions (updater/process/mcp-bridge/window-state/start-dragging would fail the Android build). |
| `tauri android init` **ignores** app icons; Gradle template has **no release signingConfig**; GitHub `bash -e` kills steps whose `grep` finds nothing; `--target aarch64` still emits `app-universal-*.apk`; debug APKs ≈ 143 MB, release ≈ 8.5 MB | All five applied in `android-build.yml` + `scripts/patch-android-release-signing.mjs` (§7). |
| Keyboard: `100dvh` alone is wrong on overlay-keyboard devices; setting shell height from `visualViewport` double-subtracts | `keyboardInset = layoutHeight - (visualHeight + offsetTop)` (0 when pinch-zoomed), applied as **padding**, unit-tested (§6). |
| Hover-revealed controls are unreachable on touch; HTML5 DnD never fires; Enter-to-send fights the IME; `<16px` inputs trigger focus-zoom | `touch:` Tailwind custom variant + component fixes (§6). |

## 2. Architecture rules (from the lessons doc, adopted)

1. **One app, not two.** Same route/components; presentation split by a
   boot-time `mobile` class on `<html>`. No second project, no per-feature
   `useIsMobile()` hook — one module-level decision (`src/utils/platform.ts`),
   CSS drives styling, JS branches only where behavior must change.
2. **Detect by UA + coarse pointer, not width**; `?mobile=1|0` query override
   for testing the phone shell in a desktop browser.
3. **Three separate facts**: "in Tauri" (`isTauri`), "render mobile" (`IS_MOBILE`),
   desktop shell. Desktop Tauri stays 100 % untouched behaviorally.
4. Keep one storage API per concern; the platform picks the backend (AI key §4).

## 3. Mobile file model

Android scoped storage makes arbitrary-path reading unreliable, and SAF URIs
are unreadable by `std::fs`. Therefore on mobile the working root is the
**app-private notes directory**: `{app_data_dir}/notes`.

- New Rust command **`get_notes_dir`** (all platforms, used by mobile UI):
  creates the dir if missing, returns its path. Seeded with a `Welcome.md` on
  first run (mobile only) so a brand-new user has something to tap.
- **Open** on mobile = in-app Files sheet (existing `FileExplorer`, full-screen),
  rooted at the notes dir (or the current file's dir, same as desktop).
  The plugin-dialog `open()` path stays for desktop only.
- **Save As** on mobile = in-app name modal (`SaveAsNameModal`): filename →
  `{notes_dir}/{name}.md` (extension normalized, overwrite confirmed via `ask()`).
  Implemented as an injected `promptSavePath` strategy in `useFileSession`
  (desktop default = plugin-dialog `save()`, unchanged; mobile = the modal).
  This covers all three save-as paths: manual, close-tab save, close-window save.
- Recents/session/last-file persistence keeps working unchanged (paths under the
  notes dir are stable across launches — same app-data dir, same app uid).

## 4. Rust changes

| File | Change |
|---|---|
| `Cargo.toml` | Move `tauri-plugin-single-instance`, `keyring`, `tauri-plugin-mcp-bridge` into the existing `cfg(not(android|ios))` target deps. `reqwest` untouched (already rustls). |
| `lib.rs` | Wrap single-instance plugin registration + mcp-bridge registration in `#[cfg(desktop)]` (mcp-bridge becomes `all(debug_assertions, desktop)`). `get_cli_file` command stays (returns `None` on mobile, harmless). |
| `commands.rs` | AI-key commands cfg-split: desktop = keyring (unchanged), mobile = `{app_data_dir}/ai-key` file, atomic temp+rename write (per the lessons doc's storage rule). Same JS contract. New `get_notes_dir` command + `Welcome.md` seeding. |
| `pdf.rs` | Already platform-stubbed (Windows/macOS impl, Linux no-op); verifies as-is for Android. UI hides PDF export on mobile. |
| `tauri.conf.json` | CSP: add `http://ipc.localhost` to `default-src` and `connect-src` (base config per lessons §1.7). |
| `tauri.android.conf.json` (new) | Restated `app.windows` = `[{label:"main", title:"Paperling", backgroundColor:"#0a0a0a"}]`; `bundle.android.minSdkVersion: 24`; `createUpdaterArtifacts: false`. |
| `capabilities/default.json` | Add `"platforms": ["macOS","windows","linux"]`. |
| `capabilities/mobile.json` (new) | `android`+`iOS`: core:default, window show/set-focus/set-title, opener (open-url), fs default + write-text/write-file + scope, dialog:default. No updater/process/mcp-bridge/window-state/start-dragging. |

## 5. Frontend: new pieces

| Piece | Purpose |
|---|---|
| `src/utils/platform.ts` | `isTauri()`, pure `detectMobileDevice()` (UA + `matchMedia('(pointer: coarse)')`), one-shot `IS_MOBILE` resolved at import with `?mobile=1|0` override, `initPlatformClass()` adding `mobile`/`touch` to `<html>`. Unit-tested. |
| `src/utils/keyboardInset.ts` + `src/hooks/useKeyboardInset.ts` | The difference-of-viewports algorithm from the lessons doc (§3.3), writes `--keyboard-inset` to `:root`, ignores pinch-zoom, `focusin` → `scrollIntoView({block:'nearest'})` + root `scrollTop` pin. Pure fn unit-tested. |
| `src/components/MobileTopBar.tsx` | 48 dp app bar: ☰ menu (New, Browse notes, Save, Save as, Find, Replace, Search in files, Export HTML/MD, Stats, Settings), centered file name + dirty dot, right: palette (search) + AI toggle. Replaces TitleBar on mobile. |
| `src/components/MobileBottomNav.tsx` | Fixed bottom bar, ≥48 dp targets, safe-area padding: Files, New note, Format (toggles toolbar), Read/Edit, AI. Replaces StatusBar + ModeToggle on mobile. |
| `src/components/SaveAsNameModal.tsx` | Mobile save-as name prompt (see §3). |
| `src/utils/mobileFiles.ts` | Pure helpers: `normalizeMarkdownFileName()` (+tests) shared by the save-as modal. |

## 6. Frontend: behavioral fixes (the lessons doc applied)

1. **Keyboard**: `useKeyboardInset` in the app shell; `--keyboard-inset` consumed
   by shell padding-bottom, AI panel, and FindBar offsets. Shell uses
   `100vh`→`100dvh` fallback chain. No viewport-height subtraction anywhere.
2. **Touch variant**: `@custom-variant touch (@media (hover: none) and (pointer: coarse))`
   in index.css; hover-revealed controls get explicit `touch:` twins:
   TabBar close/dirty dot, preview code Copy, heading anchors, WelcomeScreen
   recents remove, AI chat history delete.
3. **Drag**: tab HTML5 reorder disabled on mobile; long-press (500 ms, >10 px
   movement cancels, following click suppressed) opens the existing tab context
   menu, which gains **Move left/right** actions (keyboard-accessible reorder
   promoted to primary per lessons §5.2).
4. **Enter**: AI composer inserts a newline on mobile; the visible Send button is
   the send path; the "Shift+Enter" hint is hidden on mobile.
5. **Targets/fields**: 16 px min for inputs/textarea/select under `html.mobile`
   (prevents focus-zoom); bottom nav + menu items ≥48 dp; FormatToolbar becomes
   a horizontally scrollable strip with ≥40 dp buttons, default-on on mobile.
6. **Sheets**: on mobile the left drawers and the AI panel become full-screen
   overlays (CSS on `data-panel` attributes); App skips the desktop
   `paddingLeft/paddingRight` reflow reservations.
7. **Modals clamped**: UnsavedChangesDialog `w-[min(380px,calc(100vw-1.5rem))]`,
   ShortcutCheatsheet `min(640px,…)`, SettingsModal responsive (sidebar becomes a
   horizontal icon rail under `html.mobile`), FindBar `min(560px, 100vw-1rem)`.
8. **Desktop-only surfaces hidden on mobile**: StatusBar, ModeToggle pill,
   fullscreen toggle + its palette entry, Tour (auto-start + palette entry),
   UpdateDialog (updater plugin not compiled → its `invoke` would be rejected),
   Export→PDF (hidden WebView print is desktop-only), "Reveal in folder".
9. **index.html**: `viewport-fit=cover` for safe-area insets; zoom stays enabled
   (16 px fields prevent focus-zoom instead).

## 7. CI (GitHub Actions only — no releases)

`.github/workflows/android-build.yml` (ubuntu-latest; triggers:
`workflow_dispatch`, push to `android-app`, PRs to `main` touching app code):

1. rustup `aarch64-linux-android` target; runner's **preinstalled NDK**
   (`ls -d $ANDROID_HOME/ndk/* | sort -V | tail -1` → `NDK_HOME`).
2. bun install (frozen lockfile).
3. `tauri icon public/icon.svg` → generates `src-tauri/icons/android/*`.
4. `tauri android init` (gen/ is **not committed**; .gitignore gains
   `src-tauri/gen/` — every customization lives in checked-in config/CI).
5. Copy generated mipmaps over `gen/android/app/src/main/res/` + adaptive-icon
   round variant + background color (lessons §2.6).
6. `scripts/patch-android-release-signing.mjs` — idempotent Kotlin-DSL patch:
   release signingConfig falls back to the **debug key** when no
   `keystore.properties` exists (nobody waits on a signing secret; artifact is
   named `-testkey`). Avoids the two documented Kotlin traps (`java.` prefix,
   `Properties` cast).
7. `tauri android build -- --target aarch64 --apk` (release — debug APKs are
   143 MB vs 8.5 MB).
8. Collect `gen/android/app/build/outputs/apk/**/app-universal-*.apk` (never
   filter on `*arm64*`; scope to `outputs/`), upload as artifact
   `paperling-android-aarch64-test-apk`. `|| true` on any probe grep/final
   `find` whose empty result is legal. `concurrency` group cancels superseded
   runs.

The existing `ci.yml` / `test-build.yml` / `release.yml` are untouched.

## 8. Risk register (with fallbacks)

| Risk | Mitigation |
|---|---|
| `aws-lc-sys` (reqwest default TLS) needs cmake/clang for NDK cross-compile | Runners ship cmake+clang; aws-lc-sys supports Android. Fallback: switch reqwest to `default-features=false, features=["rustls-no-provider","stream"]` + explicit `ring` provider dep. |
| Gradle patch anchors drift with CLI template versions | Script is regex-based, idempotent, verifies markers post-patch and fails loudly with the file content logged. |
| `tauri icon` SVG input issues | `public/icon.svg` is hand-made; if rejected, rasterize a 1024 px PNG via the repo's existing `sharp` devDependency and feed that. |
| CM6 composition on Android keyboards | CodeMirror 6 ships first-class Android IME handling; no action, flagged for device testing. |
| First Android build time (full dep tree cross-compile) | Expected 15–30 min on CI; rust-cache keyed per target. |
| keyring-less API key = plaintext in app-private storage | Accepted for v1 (sandboxed per-app uid, same threat class as localStorage which the app already uses for everything else); documented in the settings screen note. |
| iOS | Out of scope for this branch, but the capability file and `#[cfg(mobile)]` gates keep it a config-only follow-up. |

## 9. Verification before merge

- Local: `cargo check`, `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `bun run build` (tsc + vite), `bun run test` (vitest incl. new
  platform/keyboard-inset/mobile-files tests).
- CI: green `CI` on the branch + a successful `android-build` run producing the
  signed (debug-key) APK artifact.
- Cannot be verified without a device (stated honestly): IME behavior, keyboard
  inset on real hardware, back-gesture handling, launcher icon rendering.
  The workflow output (APK artifact) is the test deliverable.
