# Paperling: Improvement Suggestions

A full review of the codebase (v1.0.44) with a focus on robustness, user friendliness, and the new tabs feature. Organized by priority so it can be worked through top to bottom. File references point at the current code.

---

## Implementation status (branch `feat/tabs-robustness`)

Most of this document has now been implemented and committed on the `feat/tabs-robustness` branch (each item its own commit, all with `tsc` + tests + production build passing; Rust changes have `cargo test` passing).

**Done:**

- **1.1** Undo isolation on tab switch — history reset via `docSwapId` + a history compartment (TABS-03).
- **1.2** Window close prompts for ALL dirty tabs, with a multi-file Save all / Discard all dialog (TABS-04).
- **1.3** Background-tab autosave + focus-time external-change detection for every open tab (TABS-06).
- **1.4** Save / Discard / Cancel dialog on dirty tab close (TABS-05).
- **1.5** Full multi-tab session restore, replacing single-file `lastFile` (TABS-07).
- **2.2** Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageUp-Down / Ctrl+1-9 / Ctrl+Shift+T reopen-closed (TABS-15/16).
- **2.3** Numbered/reused untitled buffers + duplicate-name folder disambiguation (TABS-08/09).
- **2.4** Tab bar overflow: wheel-scroll, scroll-active-into-view, min-width (TABS-13).
- **2.5** Keyboard a11y for the tablist (roving tabindex, arrows, Home/End, Delete) (TABS-14).
- **2.2 (4-5)** Drag-reorder (TABS-10) + right-click context menu (TABS-12).
- **2.6** Palette "Open tabs" section + Close-tab command, multi-file open/drop, search-jump race fix (TABS-11, SEARCH-01).
- **3.3 / 3.5** EOL preservation + fsync-before-rename in `save_file` (EOL-01, SAVE-02).
- **4.1** Native window title sync (TITLE-01).
- **4.2 / 4.4 / 6.4** Recents cap raised to 25, `.txt` open/drop support, `errMessage` helper (TXT-01, QUALITY-02).

**Intentionally deferred (need a running Tauri app to verify — not safe to ship untested on real documents):**

- **3.1** Native file watcher (`notify` crate) — new Rust dependency + watch-thread lifecycle + reload-loop risk. The focus-time detection (1.3) covers the common cases in the meantime.
- **3.2** Crash-recovery drafts — fs-permission/quota-sensitive storage + a recovery UI + draft/tab reconciliation. Deserves its own design pass with the app running.
- **2.2 (6)** Tab pinning, **3.4** encoding tolerance (UTF-16/BOM), **3.6** settings-in-app-data, **5.x** per-block preview memoization, **6.1** App.tsx split, **6.3** typed event bus — larger or lower-priority; left as follow-ups.

---

## 1. Critical: bugs and data-loss risks in the current tab implementation

These are real defects in what shipped, not polish. Fix these before adding any new tab features.

### 1.1 Undo (Ctrl+Z) after a tab switch restores the PREVIOUS file's content

The app keeps ONE CodeMirror instance and swaps the whole document on tab switch (`CodeEditor.tsx` ~line 505: `view.dispatch({ changes: { from: 0, to: doc.length, insert: content } })`). That dispatch is a normal, undoable transaction recorded by `history()`.

Consequence: open file A, switch to tab B, press Ctrl+Z. The editor "undoes" the document swap and file B's tab now shows file A's content. If autosave is on, file A's content can then be written to file B's path. This is the single most dangerous bug in the tab feature.

**Fix (recommended, architectural):** keep one `EditorState` per tab instead of one string. On switch, snapshot `view.state` into the tab and restore with `view.setState(tab.editorState)`. This fixes undo isolation AND gives you per-tab selection, scroll position, folds, and search state for free (it replaces the current `cursorLine` approximation from TABS-02).

**Fix (minimal, if you want a quick patch first):** dispatch the swap with `annotations: Transaction.addToHistory.of(false)` and explicitly clear/reset history on switch. This stops the disaster but still loses per-tab undo history, so treat it as a stopgap.

### 1.2 Window close silently discards unsaved changes in BACKGROUND tabs

`onCloseRequested` in `App.tsx` (~line 568) only checks `contentRef.current !== originalContentRef.current`, i.e. the active tab. If tab A is dirty but tab B is active and clean, Alt+F4 closes without any prompt and tab A's edits are gone. `handleSaveAndCloseWindow` likewise only saves the active buffer.

**Fix:** the close check must scan `tabsRef.current` too (`isTabDirty` already exists in `tabsModel.ts`). Upgrade `UnsavedChangesDialog` to list all dirty tabs by name and offer "Save all / Discard all / Cancel". Untitled dirty tabs need a save-as prompt per tab or an explicit "will be discarded" line in the dialog.

### 1.3 Autosave and external-change detection only cover the active tab

- `useAutosave` receives the live `filePath`/`content`, so a dirty background tab never autosaves, even with autosave enabled. Users will reasonably assume "autosave on" means all open files.
- `useExternalChangeWatcher` stats only the active file on window focus. If a background tab's file changes on disk, nothing is detected until that tab is activated, and even then `activateTab` does NOT re-stat the file, so the user can be looking at stale content until the next window blur/focus cycle.

**Fix:**
- Autosave: after the active-buffer save, also flush any dirty background tabs (they have `filePath`, `content`, `knownMtime` in their snapshots). Or simpler: autosave a tab when it is deactivated (snapshot time is a natural save point).
- External changes: on `activateTab`, stat the incoming tab's file and run the same clean-reload / dirty-warn logic. On window focus, loop over all open tabs, not just the active one (a single `get_file_info` per tab is cheap; you could also add a batched Rust command).

### 1.4 Close-tab prompt has no "Save" option

`closeTab` (`App.tsx` ~line 678) uses `ask("Discard unsaved changes...?")`, a two-button dialog: discard or cancel. Every other editor offers three choices. To save-then-close today the user must cancel, switch to the tab, Ctrl+S, then close again.

**Fix:** reuse `UnsavedChangesDialog` (it already has Save / Discard / Cancel) for tab close, not just window close.

### 1.5 Session restore and `lastFile` fight with the tabs model

- Only ONE file is restored at launch (the boot effect seeds a single tab). Users who had five tabs open get one back.
- `applyTabToLive` calls `setLastFile(tab.filePath)` on every switch, `handleNewFile` calls `setLastFile(null)`, and closing the last tab calls `setLastFile(null)`. So creating a new tab while three files are open wipes the restore target entirely: quit now and next launch shows the welcome screen.

**Fix:** replace the single `lastFile` key with a persisted session: `paperling:session = { tabs: [{ path, cursorLine }], activeIndex }` (paths only, never content). Write it on tab open/close/switch and on window close. On boot, restore all tabs lazily: load the active one eagerly, load the others on first activation (store just path + name until then) so launch stays fast. Keep `lastFile` reading as a one-time migration fallback.

---

## 2. Tab feature: making it feel complete

### 2.1 Architecture: consider making tabs the source of truth

Right now the live editor state IS the active tab, with refs mirroring state and snapshot/restore on every switch (`snapshotActiveTab` / `applyTabToLive`, plus five parallel `useRef` mirrors). It works, but every new feature (save all, per-tab autosave, per-tab watcher) has to reason about "live vs snapshot" and the ref-mirroring dance in `App.tsx` keeps growing.

Suggested refactor once 1.1 lands: `tabs: TabState[]` (each holding a CodeMirror `EditorState` or at least `{ path, name, editorState, knownMtime }`) plus `activeTabId`, with derived getters for the active tab. `filePath`/`content`/`originalContent`/`fileSize` stop being separate `useState`s. This removes the whole snapshot/restore concept and its edge cases (Save As already needs special tab syncing today, see `handleSaveAs`). Consider a small reducer (`useReducer`) or a tiny store (zustand) so tab operations become testable actions instead of callback chains.

Memory note: with per-tab strings or EditorStates, a 50 MB file duplicated into `content` + `originalContent` per tab adds up. For `originalContent`, consider storing a hash (dirty check) plus reloading from disk on "revert" instead of a full second copy.

### 2.2 Missing table-stakes tab interactions

In rough order of user impact:

1. **Reopen closed tab: Ctrl+Shift+T.** Keep a small stack of recently closed tab paths (+ cursor line). Cheap to build, universally expected.
2. **Ctrl+Tab / Ctrl+Shift+Tab** to cycle tabs, in addition to Alt+Left/Right. Also **Ctrl+PgDn / Ctrl+PgUp** (the VS Code/browser pair). Alt+Left alone conflicts with "navigate back" muscle memory from other editors.
3. **Ctrl+1 through Ctrl+9** to jump to tab N (Ctrl+9 = last tab, like browsers).
4. **Drag to reorder tabs.** HTML drag events or pointer-based reordering on the `TabBar`; the model just needs an `moveTab(fromIdx, toIdx)` helper in `tabsModel.ts` (easy to unit test).
5. **Tab context menu (right-click):** Close, Close Others, Close to the Right, Close Saved, Copy Path, Reveal in Folder. You already have `revealItemInDir` and copy-path in the palette; this is mostly wiring. The Close-many variants need the dirty-check loop from 1.2.
6. **Pin tabs** (pinned tabs shrink to icon-only, always leftmost, Ctrl+W skips them). Nice-to-have, do after the above.
7. **"Save All"** command (palette + Ctrl+Alt+S is a common binding) once background tabs can be saved.

### 2.3 Tab labels: duplicates and untitled buffers

- Two open files both named `README.md` render identically. Disambiguate with the parent folder like VS Code: `README.md — docs` vs `README.md — src`. Compute the minimal distinguishing suffix in `tabsModel.ts` (pure, testable).
- Every new buffer is `Untitled.md`. Number them: `Untitled-1.md`, `Untitled-2.md`. Also: `findTabByPath` never matches null paths, so Ctrl+N repeatedly stacks identical-looking tabs; numbering makes this sane. Consider reusing an existing EMPTY untitled tab instead of creating another.

### 2.4 Tab bar overflow behavior

`TabBar.tsx` uses `overflow-x-auto` with `max-w-[200px]` per tab and no min width. With many tabs:

- There is no min-width, so nothing stops unreadable slivers on very narrow windows.
- A horizontal scrollbar on a 36px-tall strip is awkward; wire mouse wheel to horizontal scroll (`onWheel` translating deltaY to scrollLeft) like browsers do.
- Add an overflow affordance: a dropdown button listing all open tabs (with dirty dots) when the bar overflows, or at minimum auto-scroll the active tab into view on activation (`scrollIntoView({ inline: "nearest" })` after switch; today activating a hidden tab via Alt+Right leaves it out of view).

### 2.5 Tab keyboard accessibility

Tabs are `div role="tab"` activated by `onMouseDown` only. They are not focusable and cannot be operated by keyboard at all (the WAI-ARIA tabs pattern expects Tab to focus the tablist and Left/Right + Enter to move/activate). Add `tabIndex` (roving tabindex: 0 on active, -1 on others), `onKeyDown` for Arrow/Home/End/Enter/Space, and Delete to close. This also matters for screen readers, and the ROADMAP already lists an accessibility pass.

### 2.6 Tabs and the rest of the app

- **Command palette:** add an "Open tabs" section (switch to tab by name) and a "Close tab" command. The palette is your power-user surface; tabs should be reachable from it.
- **Drag-and-drop multiple files:** the DRAG_DROP handler takes `paths[0]` only. With tabs there is no reason not to open every dropped `.md` in its own tab.
- **Open dialog:** `open({ multiple: false })` in `handleOpenFile`; flip to `multiple: true` and loop, same reasoning.
- **File explorer / global search results:** already route through `loadFile`, which reuses existing tabs. Good. But `handleOpenSearchResult` jumps to a line with a fixed 120 ms `setTimeout`; on a large file that loses the race and lands at the top. Fire the goto-line after the load resolves (loadFile is async, await it) or dispatch it from the same requestAnimationFrame path `applyTabToLive` uses.
- **Per-tab view mode (optional):** `mode` is global. Reasonable default, but remembering that "notes.md was in reader, draft.md was in split" per tab is a small delight once TabState is the source of truth. Ship as a setting if unsure.
- **Middle-click:** you handle button 1 on mousedown; also `preventDefault` on `auxclick`/`mouseup` so WebView2 never triggers autoscroll cursor mode on Windows.

---

## 3. Robustness (beyond tabs)

### 3.1 Real file watching instead of focus polling

External changes are only detected on window focus (`useExternalChangeWatcher`) and the file explorer refreshes on focus too. If Paperling and a terminal/AI tool are visible side by side (increasingly common: people run Claude/agents that edit files while watching the preview), edits on disk never appear until the user clicks away and back. Add the `notify` crate in Rust (or `tauri-plugin-fs` watch) to watch open files + the explorer directory and emit a `file-changed` event to the webview. Keep the focus check as fallback. This turns Paperling into a genuinely good "live markdown preview for agent workflows" tool, which is a real niche.

### 3.2 Crash recovery drafts

The close-requested interception protects against intentional close, but a crash, WebView2 failure, or forced OS update loses every dirty buffer, and untitled buffers entirely. Periodically (every ~30 s, and on tab deactivate) write dirty buffers to an app-data drafts folder (`$APPDATA/paperling/drafts/<hash>.md` plus a small manifest). On launch, if drafts exist that are newer than their files (or are untitled), offer recovery. Delete a draft on clean save/close. This is the biggest single robustness win available and is invisible when everything works.

### 3.3 Line endings are silently normalized

CodeMirror normalizes documents to `\n`. A CRLF file opened and saved comes back as LF, which makes noisy git diffs and confuses Windows users (your core audience). Detect the dominant EOL in `read_file` (or in the frontend before creating the editor state), store it on the tab, and re-apply on save. One field, big trust win.

### 3.4 Encoding tolerance

`read_file` (Rust) presumably rejects or mangles non-UTF-8 files. Detect BOM/UTF-16 (a Notepad classic on Windows) and either convert transparently (remember the encoding for save) or fail with a clear "this file is UTF-16" message rather than a generic error.

### 3.5 Durability of the atomic save

The temp-file-plus-rename in `save_file` is correct against partial writes, but there is no fsync before the rename; on power loss the rename can survive while the data does not. Call `file.sync_all()` on the temp file before renaming (and ideally fsync the directory on Linux). Cheap insurance for an editor whose whole job is not losing words. Also note: rename-over-target breaks hard links and resets some ACLs/metadata; acceptable trade-off, but preserve file mode on Unix when you do the macOS/Linux builds on the roadmap.

### 3.6 Settings storage

Everything persists in localStorage. WebView2 profile data can be wiped by "reset app", Windows cleanup tools, or corporate policy, and it is invisible to users who back things up. Consider migrating persistence.ts to a JSON file in app-data via a small Rust command or `tauri-plugin-store` (keep the localStorage read as migration). This also makes settings portable and debuggable. Low urgency, high "my settings vanished" complaint prevention.

### 3.7 Number normalization bug class in `mtime`

You compare `info.modified > known` with mtimes flowing through several layers (Rust u64 ms → JSON → JS number → refs → tab snapshots). One place stores `fileData.modified ?? 0` and another awaits `save_file`'s return. Worth an integration test: save, external touch, focus, assert exactly one reload toast. The mtime plumbing across tabs (each tab has `knownMtime`, plus the global `knownMtimeRef`) is exactly where a stale value will eventually hide.

---

## 4. User friendliness / ease of use

1. **Window title.** Set the native window title to `name — Paperling` (with a dirty marker) via `Window.setTitle` on tab switch/dirty change. Alt-Tab and the taskbar currently cannot tell two Paperling scenarios apart.
2. **Recent files: raise the cap and surface them more.** `MAX_RECENT = 10` is tight once tabs make multi-file work normal. Raise to 20 to 30, add "clear recents" (exists) and pin-to-recents. Consider a jump-list integration on Windows (Tauri supports taskbar jump lists via plugins) so right-clicking the taskbar icon opens recent files.
3. **File explorer upgrades.** It is a flat list of siblings that closes on selection. With tabs, the natural next step (already "Later" on the roadmap): make it a pinnable sidebar (not an overlay that steals focus), keep it open after selecting, mark open-in-tab files and dirty state, and add basic file ops (new file here, rename, delete to trash) with inline UI. Rename/delete need Rust commands plus tab-path fixups; scope carefully but "new note in this folder" alone is high value for the wikilink workflow.
4. **`.txt` support.** You accept `.md`/`.markdown` everywhere (open dialog, drag-drop filter, explorer listing). Plain `.txt` opening is a common ask for a lightweight editor and costs almost nothing (skip preview features gracefully).
5. **Reveal keyboard shortcut conflicts early.** Alt+Left/Right for tabs will surprise people who expect word navigation... actually Alt+arrows are safe, but document them in the cheatsheet next to the new Ctrl+Tab bindings so all tab shortcuts live in one visible row. The cheatsheet and Tour should both gain a tabs entry (the Tour currently teaches modes/themes but not tabs, and tabs are your newest concept).
6. **Autosave default.** Consider defaulting autosave ON for files with a path (keep off for untitled). You already have external-change detection and atomic writes; the modern expectation (Obsidian, Notion, VS Code with autosave) is that words are never lost. At minimum, prompt once: "Turn on autosave?" after the first unsaved-changes dialog.
7. **Toast fatigue.** "File saved" on every Ctrl+S is noise once autosave is common; the status-bar dot already communicates it. Reserve toasts for failures and unusual events.
8. **Search-in-files polish.** Results jump has the timing race (2.6). Also consider showing the match count cap ("300 files max") in the UI when hit, so truncation is never silent.

---

## 5. Performance

1. **Preview re-parse is O(document) per debounce tick.** The debounce scaling (PREVIEW-01) is good, but react-markdown still re-parses and re-renders the entire document. For the "large file" tier, consider memoizing per-block: split source into top-level blocks (cheap line scan), render each block through its own memoized component, and only re-render blocks whose source changed. This is the standard trick (Milkdown/Typora-style) and turns typing in a 5k-line doc from "re-render everything" into "re-render one paragraph". It is a meaty change; do it behind a flag and only if users report lag beyond the debounce.
2. **Dirty checks on large strings.** `isDirty` (`content !== originalContent`) is O(n) worst case per render, and `tabBarItems` compares every inactive tab's full content inside a `useMemo`. Fine today; if you adopt per-tab EditorStates, track dirtiness with a changed-since-save flag (CodeMirror gives you doc identity cheaply) instead of string compares.
3. **Bundle: verify mermaid and katex are lazy.** Mermaid alone is ~1 MB. `MermaidBlock` should dynamic-import mermaid on first diagram encounter, and katex CSS/fonts should only load when math is present. If already done, ignore; if not, this is the biggest remaining cold-start lever after your existing lazy-loading work (which is genuinely well done).
4. **Tab switch cost.** With `view.setState` (per 1.1) a switch is O(1)-ish. With the current full-document dispatch it re-parses and re-highlights the whole file. Another reason 1.1 is the right fix.

---

## 6. Code health and testing

1. **App.tsx is 1,700 lines** and owns file IO, tabs, palette items, shortcuts, close handling, AI wiring, and layout. The tab refactor (2.1) is the natural moment to extract: `useTabs()` (all tab state + operations), `useFileIO()` (load/save/save-as), `usePaletteItems()`. Target: App.tsx under ~600 lines of composition. This directly helps the "hand to Opus to implement" workflow too: smaller files, safer diffs.
2. **Test the tab flows, not just the model.** `tabsModel.test.ts` covers the pure helpers, but every bug in section 1 lives in the App-level glue (snapshot/restore, close paths, boot seeding). Add React Testing Library tests: open two files (mock invoke), edit one, switch, assert content isolation; close dirty tab, assert dialog; Ctrl+Z after switch (regression for 1.1); Alt+F4 with dirty background tab (regression for 1.2).
3. **Event-bus coupling.** Cross-component communication runs through ~10 window CustomEvents (`paperling:*`). Workable, but they are stringly-typed and invisible to TypeScript. Centralize them: one `events.ts` with typed `emit`/`on` helpers and a union of event names/payloads. Zero runtime change, much safer refactoring.
4. **Error message extraction is duplicated ~8 times** (`typeof err === "string" ? err : (err as {message?...})`). Extract `errMessage(err): string` into utils.
5. **CI checks.** Ensure `tsc`, tests, and `cargo test` run on PRs (they may already); add `cargo clippy -- -D warnings` and a basic `eslint` config if missing.

---

## 7. Suggested implementation order (for the Opus handoff)

Phase 1 (correctness, do first, roughly a week of focused work):
1. Per-tab CodeMirror `EditorState` + `view.setState` on switch (fixes 1.1, improves 2.4-adjacent restore fidelity and 5.4).
2. Dirty-check ALL tabs on window close + upgraded UnsavedChangesDialog with per-tab list and Save All (1.2).
3. Three-way Save/Discard/Cancel on tab close (1.4).
4. Stat the incoming file on tab activation; extend focus check to all tabs (1.3 external half).
5. Autosave flush on tab deactivate (1.3 autosave half).

Phase 2 (session + expected interactions):
6. Persisted multi-tab session restore replacing `lastFile` (1.5).
7. Ctrl+Tab / Ctrl+PgUp/PgDn / Ctrl+1..9 / Ctrl+Shift+T reopen-closed (2.2 items 1 to 3).
8. Duplicate-name disambiguation + numbered untitled tabs (2.3).
9. Tab bar overflow: wheel scroll, scroll-active-into-view, min-width (2.4).
10. Keyboard accessibility for the tablist (2.5).

Phase 3 (robustness):
11. Crash-recovery drafts (3.2).
12. EOL preservation (3.3) and fsync-before-rename (3.5).
13. Native file watcher (3.1).
14. Window title sync (4.1).

Phase 4 (delight):
15. Tab context menu, drag reorder, pinning (2.2 items 4 to 6).
16. Palette "Open tabs" section, multi-file drop/open (2.6).
17. Explorer upgrades, `.txt` support, per-block preview memoization as needed.

Each phase is shippable on its own. Phase 1 items are individually small PRs; keep them separate so regressions are bisectable.
