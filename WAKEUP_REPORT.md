# Paperling — Full Expert Audit & Wake-Up Report

*Generated 2026-09-21 by an autonomous audit session. Method: (1) ran the app live (`vite` on port 5273) and drove it in a real browser — welcome screen, tour, editor, slash menu, find/replace, palette, cheatsheet, settings, themes, split view, reader, TOC, backlinks trigger, mermaid rendering, task write-back, zen mode, 390px viewport; (2) four parallel deep code audits covering editor/shortcuts, preview/rendering, app shell/state, and settings/AI/theme/a11y; (3) full test suite run — **488/488 passing**, healthy baseline.*

**Test setup note:** the dev server is still running at `http://localhost:5273/` if you want to poke at anything yourself.

---

## 0. TL;DR — The 10 things to do first

| # | Item | Type | Effort |
|---|------|------|--------|
| 1 | Background-tab autosave can **overwrite external file changes with no conflict check** (P0 data loss) | Bug | ~1h |
| 2 | **Mermaid diagrams: add zoom / pan / fullscreen** (your explicit question — today there is none) | Feature | 3–5h |
| 3 | Find & Replace can **corrupt text at stale offsets** when replacing quickly | Bug | 2h |
| 4 | **Hot exit**: persist unsaved buffers so a crash/force-quit loses nothing | Feature | 3–4h |
| 5 | One-line fixes batch: `defaultPrevented` guard (kills a whole class of shortcut conflicts), macOS Alt+Arrow tab-switch hijack, Linux Ctrl+J dead key, Tab-destroys-selection, code-block caret off-by-one | Bugs | 2h |
| 6 | **Global Search & Replace** across files (biggest functional gap in search) | Feature | 4–6h |
| 7 | Slash menu **fails to open when "/command" is typed at natural speed** (live-reproduced; must retype slowly) | Bug | investigate + fix, 2–4h |
| 8 | **File management in the explorer**: create/rename/delete (backend has zero file-mutation commands) | Feature | 1–2 days |
| 9 | **Exports: math ships without KaTeX CSS** → every `$x$` in HTML/PDF export renders as scrambled spans | Bug | 2–3h |
| 10 | **Keybinding customization UI** — the central `keybindings.ts` config already exists; only the remap layer + UI is missing | Feature | 1 day |

Everything below is the full detail, with file/line references and explanations.

---

## 1. What's already genuinely good (keep, don't rework)

An audit is only useful if it also says what *not* to touch. These are above the bar for the category:

- **Rendering pipeline security**: `rehypeRaw → rehypeSanitize` in the correct order, GitHub-derived schema, protocol allowlist, wikilink scheme with traversal checks. No XSS hole found.
- **Save integrity (active tab)**: atomic fsync-then-rename writes, EOL preservation, close-request interception covering Alt+F4.
- **Theme architecture**: 7 themes as pure CSS-variable blocks, CodeMirror follows via vars, contrast regression-tested (`theme.contrast.test.ts`), pre-paint theme in `index.html` prevents white flash.
- **Scroll sync**: rAF-coalesced, O(log n) binary search over `data-source-line` anchors — much better than the naive fraction-matching most small editors do.
- **Performance discipline in hot paths**: size-scaled preview debounce (80/160/250ms), LRU caches for images and mermaid SVGs, cursor-row detection that avoids full-doc scans.
- **Mermaid theming**: diagrams correctly re-render when switching light/dark (verified live — looks great).
- **Test culture**: 488 tests, all passing, including UI-component tests.
- **AI plumbing**: streaming with cancel, OS keychain for keys, http-refusal for non-loopback endpoints, mapped error messages, per-chunk accept/reject diff review.

The gaps below are *additive features and targeted bug fixes*, not foundational rework.

---

## 2. Live browser-test results (what I personally exercised)

| Surface | Result |
|---|---|
| Welcome screen, first-run | ✅ Clean, mascot, clear CTAs |
| Welcome tour (5 steps, skippable + replayable) | ✅ Works; spotlight positioning good |
| New file, typing, bold/italic/code | ✅ |
| List / task auto-continuation on Enter | ✅ (`- item` → newline → `- ` appears) |
| Slash menu (single keystrokes) | ✅ 14 items, arrow nav, filter, Enter inserts |
| Slash menu (**typed as one burst** `/task`, `/table`) | ❌ **Menu never opens; literal text remains** (see 3.7) |
| Reader mode: math, chem, code copy, tables | ✅ (KaTeX renders; raw fallback shown in red for invalid syntax) |
| Mermaid rendering | ✅ renders + re-themes; ❌ no zoom/pan/fullscreen; small diagrams stretched to full column width |
| Task checkbox click → source write-back | ✅ `- [ ]` → `- [x]` in source |
| TOC / Outline panel + click-to-jump | ✅ |
| Split view + pane divider | ✅; ❌ at 390px both panes cram to ~180px each |
| Command palette | ✅ 32 results, fuzzy survives typos ("thme" → themes, "zen mde" → Zen), categories, headings |
| Find bar | ✅ counter "1 of 2", case/regex toggles, replace works at normal speed |
| Cheatsheet `?` | ⚠️ Only when editor NOT focused (see 3.6) |
| Settings quick menu + full modal | ✅ polished; content gaps listed in §6 |
| Theme switch (Paper → Dark) | ✅ everything follows incl. mermaid |
| Zen mode (F9) | ✅ clean reading canvas |
| Image preview (remote URL) | ❌ **infinite pulsing skeleton on load failure — no error state** (see 3.5) |
| Interactive guide (from tour/palette) | ⚠️ Opens fine, but tab is **marked dirty immediately** (see 3.8) |
| 390px viewport (desktop shell) | ❌ split view unusable at phone width (see 3.9) |

---

## 3. Bugs — detailed, with code locations

Severity: **P0** = data loss/security, **P1** = core feature broken or corrupts work, **P2** = clear defect users will hit, **P3** = polish.

### 3.1 P0 — Background-tab autosave overwrites external changes

**Where:** `src/hooks/useFileSession.ts:704-729` (background autosave) vs `:734-775` (focus-time external-change check).

**What:** The *active* tab's autosave parks when a conflict is detected (`conflictPending` in `useAutosave.ts:60`). The *background* autosave loop has no such guard — it writes every dirty background tab on a 1.5s timer, blindly.

**Repro:** Edit file A → switch to tab B (A becomes a dirty background tab, timer arms) → an external program (git checkout, sync client, another editor) writes A → 1.5s later Paperling overwrites it. If you're lucky you see a toast on refocus saying "Saving it will overwrite those changes" — and then the resulting state change *re-arms the autosave, which does exactly that*. If the autosave lands first, the external edit is silently destroyed with zero warning.

**Why it matters:** This is the exact scenario Obsidian/VS Code solve with save-time mtime checks. Sync clients (OneDrive/Dropbox) make it a matter of time.

**Fix:** Before each background write, `invoke("get_file_info")` and skip+flag when `info.modified > tab.knownMtime`; mirror the active tab's `conflictPending` parking. ~15 lines.

### 3.2 P1 — Find & Replace can corrupt text via stale match offsets

**Where:** `src/components/CodeEditor.tsx:887-987` (find controller), `src/components/FindBar.tsx:111-119, 140-147`.

**What:** Match offsets are only refreshed by `search()`, which runs on a **400ms debounce**. `replaceActive(index, ...)` reads `findMatchesRef.current[index]` — possibly from before your last replace. Replacing twice quickly with a replacement of different length shifts every subsequent offset: the second splice lands at the wrong position, corrupting a neighboring region (undoable, but cryptic). Also: after Replace, the active match does not advance (VS Code/Obsidian advance), so the keyboard flow "Enter, Replace, Enter, Replace" drifts.

**Fix:** After `replaceActive`/`replaceAll`, synchronously re-run `controller.search()` before returning (cheap at replace time), and advance `activeIdx`. Longer term, do replacements through CM transactions so positions remap automatically.

### 3.3 P1 — macOS: Alt+←/→ switches tabs AND moves the caret; window shortcuts ignore `defaultPrevented`

**Where:** `src/hooks/useGlobalShortcuts.ts:151-163` (handler), `src/config/keybindings.ts:62-63` (binding).

**What:** On macOS, Option+Arrow is the universal word-jump gesture. CodeMirror handles it and calls `preventDefault()`, but the event still bubbles to the window handler, which never checks `e.defaultPrevented` — so it *also* switches tabs. Every keypress does two things. The same missing guard causes: Ctrl+W closing a tab in vim insert mode (vim uses it for delete-word), Ctrl+E toggling mode in vim normal mode, Ctrl+O opening the file dialog during vim jumplist navigation.

**Fix (one line + one gate):**
```ts
// top of handleKeyDown:
if (e.defaultPrevented) return;
```
…and gate `prevTabAlt`/`nextTabAlt` behind `!isMac`.

### 3.4 P1 — Linux: the advertised Ctrl+J AI shortcut does nothing

**Where:** `src/hooks/useGlobalShortcuts.ts:225-230, 242-247`; label defined at `src/config/keybindings.ts:192-194`.

**What:** `aiShortcutLabel` displays "Ctrl+J" on Linux, but the handler only accepts Alt+J (`altKey`) and Cmd+J (`metaKey`) — Ctrl+J matches neither predicate *and* is then `preventDefault`ed by the WebView2 guard. The shortcut shown in the cheatsheet, toolbar tooltip and palette is a dead key on Linux.

**Fix:** `const isModJ = isMac ? e.metaKey : e.ctrlKey;` plus keep Alt+J as a universal fallback.

### 3.5 P2 — Images that fail to load render an infinite pulsing skeleton (verified live)

**Where:** `src/components/MarkdownPreview.tsx:302-348` (`LocalImage`), plus `defaultUrlTransform` interaction at `:95-96`.

**What:** When an image URL fails (network down, 404, hotlink-blocked, or `data:` URI stripped by react-markdown's `urlTransform` before `LocalImage` ever sees it), `imageSrc` stays empty and the component renders an `animate-pulse` placeholder **forever** — no error card, no alt text. My live test with a remote image showed the endless skeleton.

**Fix:** (a) allow `data:image/` through `mdUrlTransform` (the `wikilink:` pass-through shows the pattern); (b) render the existing error card when `src` is empty or `onError` fires instead of a perpetual skeleton.

### 3.6 P2 — `?` cheatsheet is undiscoverable in the state users are actually in

**Where:** `src/hooks/useGlobalShortcuts.ts:199-208`.

**What:** The cheatsheet binding deliberately ignores `?` while any input/contenteditable is focused — i.e., while you're writing, which is ~100% of the time in an editor. Pressing `?` types a literal `?` into your document. The README, the welcome hint ("? for shortcuts"), and the palette all advertise it.

**Fix:** Add an alias that works in the editor (F1 already opens the palette — so use `Ctrl+Shift+/`), and/or when `?` is typed in the editor with an empty selection at word-start, still insert it but show a one-time toast: "Tip: Ctrl+Shift+/ opens shortcuts".

### 3.7 P2 — Slash menu fails to open when the command is typed at natural speed (verified live)

**Where:** `src/components/CodeEditor.tsx:490-514` (`detectSlash`), `:229` (`slashStateRef.current = slashState` ref-during-render pattern), `:503-513` (open gate).

**What:** Typing `/` alone opens the menu. Typing `/task` or `/table` as one fluid burst — including at ~8 chars/sec — leaves the menu unopened and the literal text in the document. Reproduced repeatedly, and confirmed the menu never even flashes into the DOM. The open condition requires the *just-typed* character to be `/` at line start (`doc.sliceString(head-1, head) === "/"`); if the "/" transaction and the following letter transactions are processed before the React state/ref sync completes, the open is lost — and since the trigger only exists at the `/` keystroke, it can never recover until you delete the text and retype slowly.

**Fix direction:** Drive the slash menu from a **CodeMirror completion source** (the wikilink autocomplete already does this — `wikilinkComplete.ts` + `autocompletion({override:[wikiCompletionSource]})` at `CodeEditor.tsx:452`), computing state synchronously from the transaction instead of React state. That eliminates the entire race class and gives you CM's positioning/keyboard handling for free.

### 3.8 P2 — The interactive guide opens pre-marked as "unsaved changes" (verified live)

**Where:** `src/hooks/useFileSession.ts:525-560` (`openTutorial`).

**What:** `openTutorial` sets `content === originalContent` (clean by construction), yet the freshly opened tab shows the dirty dot and "(unsaved changes)" in the tab title. Likely a race: `snapshotActiveTab()` (line 531) runs before `commitTabs`/`setActiveTab` (545-548), so the *previous* document's live content gets snapshotted into the new active tab, flipping its dirty flag before the editor's doc-swap lands.

**Why it matters:** closing the guide then nags "unsaved changes", autosave parks, and it erodes trust in the dirty indicator everywhere.

**Fix:** make the active-tab snapshot effect skip the cycle in which `activeTabId` changed (or key the snapshot by `docSwapId`), and add a regression test that opens the tutorial and asserts `!isDirty`.

### 3.9 P2 — Desktop split view is unusable at phone/narrow widths (verified live)

**Where:** `src/App.tsx:1680-1762` (split layout); shell choice is boot-time in `src/utils/platform.ts:84-115`.

**What:** At a 390px viewport (or any narrow desktop window), split view keeps BOTH panes side-by-side — each ~180px wide, text wrapping every 2-3 words. The mobile shell (which does the right thing) is only selected via user-agent at boot, never by viewport.

**Fix:** below ~700px, force single-pane (auto-collapse to editor or reader) and let the mode toggle switch panes; or boot the mobile shell when `matchMedia('(max-width: 640px)')` matches too, not just UA.

### 3.10 P2 — HTML paste: caret read after an await → paste can land in the wrong place

**Where:** `src/components/CodeEditor.tsx:580-589`.

**What:** For rich-HTML paste, the handler `preventDefault`s, then `await`s `htmlToMarkdown(html)` (first use lazily imports turndown), and only *then* reads `view.state.selection.main` to compute the paste range. If the user types or clicks during that window, the paste replaces the new selection — deleting freshly typed text. Fix: capture the selection before the await, and re-verify it before dispatching.

### 3.11 P2 — Pasting from Excel/Google Sheets never produces a table

**Where:** `src/components/CodeEditor.tsx:576-589`; `src/utils/smartPaste.ts:38-74`.

**What:** Excel puts a full `<table>` on the clipboard *and* TSV on `text/plain`. Because `html` is present, the TSV→GFM-table path is unreachable, and turndown (no table rules — `smartPaste.ts:93-99` admits it) flattens the table into run-together text. Obsidian/Typora paste spreadsheets as markdown tables. Fix: try `pasteTsvAsTable` on the text flavor first when it looks like multi-cell TSV, or add a table rule to turndown. Also: there is **no paste-as-plain-text** (`Ctrl+Shift+V`) escape hatch at all.

### 3.12 P2 — Tab with a single-line selection deletes the selected text

**Where:** `src/utils/editorActions.ts:135-185` (branch at 180-184).

**What:** Multi-line selections block-indent correctly. But a selection *within one line* falls through to the cursor path: `text.slice(0, selStart) + INDENT + text.slice(selEnd)` — which deletes everything between `selStart` and `selEnd`. Select a word, press Tab → the word is gone. Fix: return early for single-line selections and indent the containing line instead (or hand the key to CM's `indentMore`, which preserves selection).

### 3.13 P2 — Vim mode is partially broken by keymap precedence

**Where:** `src/components/CodeEditor.tsx:343-368` (`Prec.highest` keymap), `:459-462` (extension order).

**What:** The custom editing keymap wrapped in `Prec.highest` resolves before `@replit/codemirror-vim` (which listens at default precedence). Consequences in vim normal mode: **Enter inserts a newline** instead of moving down, **Tab inserts two spaces**, **Ctrl+B/Ctrl+F** trigger bold/find instead of page-up/down, Ctrl+W closes the tab (see 3.3). Vim users on by default settings will think vim is "broken".

**Fix:** put the custom keymap in a compartment whose precedence depends on `vimMode` (highest when vim off; default/low when on), and/or make each `run` return `false` when vim normal mode is active.

### 3.14 P2 — Table ops can absorb a prose line containing a `|` and rewrite it

**Where:** `src/utils/tableModel.ts:47-50` (`isPipeRow`), `:94-125` (`findTableAt` expansion).

**What:** Any adjacent line that merely contains a pipe ("use `|` for separators") is treated as a table row; row/col operations or "Tidy table" then rewrite that prose line as a padded cell row. Note the inconsistency: Tab-navigation in `editorActions.handleTableTab` uses the stricter starts-and-ends-with-pipe check, so it's safe — the toolbar ops are not. Fix: require outer pipes (or a separator row below) for block expansion, mirroring GFM.

### 3.15 P2 — Exports ship math without KaTeX CSS (HTML & PDF)

**Where:** `src/utils/exportUtils.ts` (generated export stylesheet — zero `katex` references), flow via `ExportMenu.tsx:57-88` → `prepareExportHtml`.

**What:** The preview's `katex.min.css` is imported only into the app bundle. The standalone export document doesn't include it, so every formula exports as jumbled, unpositioned spans — in HTML export *and* the PDF (which renders the staged HTML). Related: exports capture the **debounced** preview content (`App.tsx:1058-1063`), so exporting within ~250ms of typing ships stale text. Fix: inline a trimmed katex CSS into the export `<style>` when `.katex` is present; flush `deferredContent` before exporting.

### 3.16 P2 — Global Search result click closes the panel (and resets your query)

**Where:** `src/components/GlobalSearch.tsx:90-94`.

**What:** `onOpenResult(...); onClose();` — iterating matches means reopening the panel and retyping the query each time (the component unmounts, so state dies). Obsidian/VS Code keep results docked. Fix: keep the panel open; also add `scrollIntoView` for the keyboard-active row (the palette already does this — `CommandPalette.tsx:187-192`; GlobalSearch doesn't, `GlobalSearch.tsx:96-101`).

### 3.17 P2 — Opening a new file keeps the previous file's pending AI review

**Where:** `src/hooks/useFileSession.ts:245-301` (`loadFileDirect` never calls `clearReview()` — contrast `applyTabToLive:195`).

**What:** With an AI proposal pending (diff view active), opening any other file leaves `reviewDoc` pointing at the OLD document; the merge view then renders nonsense diffs of old-file content against the new file, and its chunk buttons would write old-file text into the new file. Also keeps autosave parked for the new file. Fix: `clearReview()` (+ `setConflictPrompt(null)`) at the top of `loadFileDirect`'s success path.

### 3.18 P2 — Conflict dialog: Escape means "Keep mine" and arms an overwrite

**Where:** `src/components/ConflictDialog.tsx`; `App.tsx:1899-1908` (`onClose={handleConflictKeepMine}`); `useExternalChangeWatcher.ts:54-55`.

**What:** Dismissing the conflict via Escape/backdrop resolves as keep-mine; since the watcher already absorbed the new disk mtime, the next autosave (1.5s later) overwrites the external version. There's no diff preview, no "keep both (save a copy)", no backup of the disk version. Fix: make Escape = cancel (stay parked), and add "Save a copy" — cheap and turns the scariest dialog into a safe one.

### 3.19 P2 — "Save all and close" bypasses the conflict guard

**Where:** `src/App.tsx:646-672` (`handleSaveAndCloseWindow`).

**What:** Manual save refuses while a conflict is pending (`useFileSession.ts:637`), but the window-close "Save all" loop writes every dirty tab unconditionally — including the conflicted one — silently overwriting the external version the dialog promised to protect.

### 3.20 P2 — In-flight autosave resolving after a tab switch corrupts the new tab's state

**Where:** `src/hooks/useFileSession.ts:685-688` (`handleAutosaved`), `src/hooks/useAutosave.ts:61-64`.

**What:** The save's `invoke` is async; if the user switches tabs while the write is in flight, the resolution stamps the NEW tab's `originalContent`/`knownMtime` with the OLD tab's values → wrong dirty flags (possible real-edit loss via "clean" close) and bogus external-change detection. Fix: pass the saved path through `onSaved` and bail unless it equals the current path. One line + a test.

### 3.21 P2 — TOC lists headings inside code fences

**Where:** `src/components/TableOfContents.tsx:40-52`.

**What:** The outline is built by a line regex with no fence tracking, so `# comment` lines inside bash/python/yaml blocks (and frontmatter) become outline entries that jump into the middle of code blocks. Any doc with shell scripts pollutes the outline. Fix: track ``` state while scanning; skip frontmatter.

### 3.22 P2 — Clicking a relative non-markdown link can navigate the whole webview away

**Where:** `src/components/MarkdownPreview.tsx:831-849`.

**What:** Only `http(s):`/`mailto:` links are intercepted. A relative link like `[report](report.pdf)` keeps its href in the DOM; the click navigates the Tauri webview to `tauri.localhost/report.pdf` → blank page, app "gone" (tabs survive via persistence, but it looks like a crash). There's no `on_navigation` handler in `src-tauri/src/lib.rs` to catch it either. Fix: `e.preventDefault()` unconditionally in this handler; route non-md targets through the opener or a toast.

### 3.23 P2 — Wikilink preprocessing corrupts code blocks, inline code, and math

**Where:** `src/components/MarkdownPreview.tsx:904-910`.

**What:** The `[[...]]` → link rewrite is a single regex over the **raw document** with no fence/code-span awareness. A code block containing `[[Foo]]` visibly renders as a corrupted link, and the Copy button copies corrupted text. Fix: tiny scanner that skips fenced code / inline code / math segments, or do it as a remark micro-plugin that skips `code`/`inlineCode`/`math` nodes.

### 3.24 P2 — `![[image.png]]` embeds are broken; `![[note]]` transclusion missing

**Where:** same regex as 3.23 → `![img.png](wikilink:img.png)` → `LocalImage` tries to read a path literally named `wikilink:img.png` → red failure card.

**What:** Obsidian's most-loved syntax doesn't work. Quick half: detect `wikilink:` in the img renderer and resolve via the same baseDir logic as links (~10 lines). Note transclusion is a bigger feature (recursive render + cycle guard) — roadmap it.

### 3.25 P2 — Slugify is ASCII-only → all CJK/Cyrillic headings share one anchor

**Where:** `src/components/MarkdownPreview.tsx:217-225`.

**What:** `replace(/[^\w\s-]/g, "")` strips all non-ASCII, so `## 简介` → id `section`, a second one becomes `section-1`, and in-document links to such headings never resolve. Fix: `replace(/[^\p{L}\p{N}\s-]/gu, "")` — one regex.

### 3.26 P2 — Frontmatter card edits rewrite the whole YAML block

**Where:** `src/utils/frontmatter.ts:131-135`; `MarkdownPreview.tsx:1079-1082`.

**What:** Editing one field re-serializes every key: block lists collapse to inline arrays, `# comments` are deleted, blank lines collapsed, quoting normalized; `coerceScalar` also turns `"01234"` into `1234` and writes it back. Hand-formatted YAML is destroyed by any tag edit. Fix (cheap): splice only the edited key's lines into the original YAML text.

### 3.27 P2 — AI: no context/token management

**Where:** `src/utils/aiChat.ts:152-166, 189-203`; `src/components/AIPanel.tsx:132-135`.

**What:** The **entire document** is inlined into every send with no truncation, no token estimate, and no `max_tokens` on any request. A 300KB note → endpoint 400/413 → user sees "AI request failed (400)" + a raw JSON slice. No cost control either. Fix: estimate tokens (chars/4), warn above a threshold with an "ask about the selection instead" action, auto-truncate doc context (head+tail around selection), send `max_tokens`.

Also in AI (P2/P3):
- **"Continue" is advertised but doesn't exist** — `aiAssist.ts:19-27` defines it, `AIBubble.tsx:17-22` never offers it, `SettingsModal.tsx:458-459` promises it. Implement (needsSelection:false, insert at caret) or remove from copy.
- **AIBubble isn't keyboard accessible** — no focus move, no Escape handler (`AIBubble.tsx:93-161`); it's `role="dialog"` with no dialog behavior (should be `role="menu"` + focus + Escape).
- **Streaming isn't announced to screen readers** — no `aria-live` on the messages container (`AIPanel.tsx:383-440`); add a polite live region + `role="status"` on "Thinking…".
- **Prompt-injection surface** — `asDocument()` framing (`aiChat.ts:147-166`) is bypassable by a note containing `</document>`; use a per-request nonce delimiter and state in the system prompt that document text is data, not instructions (agent mode can propose edits, so a malicious downloaded note could try to fabricate edit instructions — the diff review is the backstop).
- **Auto-scroll fights the reader** — `AIPanel.tsx:88-91` forces scroll on every token; pin only when already at the bottom.

### 3.28 P2 — Accessibility: focus trap doesn't engage in Settings

**Where:** `src/utils/focusTrap.ts:25-42` (attaches Tab handling to the container's keydown), `src/components/SettingsModal.tsx:164-178` (never moves focus into the dialog).

**What:** Opening Settings via the gear leaves focus on the gear — *outside* the container — so the trap never fires and the whole background app remains tabbable behind the "modal"; screen readers get no dialog announcement. The cheatsheet and palette both follow up with `input.focus()` — Settings doesn't. Fix: focus the search input on open (copy the two lines from `ShortcutCheatsheet.tsx:137-139`), and have `attachFocusTrap` focus the container itself as a fallback. Related a11y quick wins: `aria-pressed` on theme tiles (`SettingsModal.tsx:275-291`, `SettingsMenu.tsx:84-109`), `group-focus-within` reveal for the Zen top bar (`ZenTopBar.tsx:92-95` — currently hover-only, so keyboard users can't see the exit), dark-theme `--text-muted` at ~2.5:1 contrast (`index.css:17-18, 167, 314` — used for real content at 11px, fails WCAG).

### 3.29 P3 batch (each small, all real)

| Bug | Where | Note |
|---|---|---|
| Editor ignores the font-size setting (hardcoded 14px) | `CodeEditor.tsx:114` | "Large" setting doesn't touch the editor; also settings *preview* sizes (13/19) don't match real sizes (14/18) (`SettingsModal.tsx:63-67`) |
| Status-bar aria-label says "N characters" while showing "N words" | `StatusBar.tsx` | screen readers read the wrong unit |
| Format toolbar "Code block" caret off-by-one (lands ON the fence) | `FormatToolbar.tsx:90-100` (`+4` should be `+5`) | typing immediately corrupts the fence |
| Slash-menu table snippet caret lands on the pipe | `SlashMenu.tsx:23` (`caretOffset: 11` → 10) | typing squeezes against `|` |
| Tab at the last table cell of a file can't create the promised row | `editorActions.ts:77-104` (`nextLs < text.length` → `<=`) | falls through to inserting 2 stray spaces |
| Slash menu renders off-screen near the viewport bottom (no flip/clamp); stale position on scroll; `% 0` → NaN activeIdx when filter empties | `SlashMenu.tsx:57-80`, `CodeEditor.tsx:507-509` | `TableToolbar` already has the measure-and-flip pattern to copy |
| Format toolbar tooltips hardcode "Ctrl+B" etc. | `FormatToolbar.tsx:118-135` | on macOS they lie; `formatShortcut()` exists — use it |
| Ctrl+F/H dead when preview pane has focus in split mode | `useGlobalShortcuts.ts:141-150` | dispatch the existing `paperling:open-find` events from the window handler |
| Multi-cursor silently collapsed by all custom actions (`selection.main` only) | `CodeEditor.tsx:152-155` | either port hot bindings to per-range CM commands or disable add-cursor |
| Enter in the Replace field navigates instead of replacing | `FindBar.tsx:149-158` | VS Code replaces; also don't run the container `onKeyDown` for the replace input |
| Find bar forgets query/case/regex between opens; no Esc-from-editor to close; find doesn't seed from selection | `FindBar.tsx:63-68` | persistence is one `usePersistedState` each |
| Blockquote toggle is single-line only; duplicated logic between keymap and toolbar | `CodeEditor.tsx:349-361`, `FormatToolbar.tsx:72-88` | toggle every selected line |
| Ordered-list Enter doesn't renumber following items; `1)` markers not continued | `editorActions.ts:235-247` | Obsidian renumbers |
| `wrapSelection` double-wraps selections that already contain markers | `editorActions.ts:333-342` | check inside the selection too |
| Dead code: `handleAutoPair`/`handleSkipCloser`/`handleBackspace` (~65 lines, tested but unwired — the `*`/`_` wrap-selection behavior they describe doesn't actually exist) | `editorActions.ts:255-320` | wire via an inputHandler or delete + fix cheatsheet copy |
| Data-URI/base64 images stripped before rendering (same skeleton as 3.5) | `MarkdownPreview.tsx:95-96, 310` | allow `data:image/` in `mdUrlTransform` |
| Mermaid duplicate SVG ids when the same diagram appears twice; no in-flight render dedupe | `MermaidBlock.tsx:59-90` | suffix cache key with block index |
| Scroll-sync cached extent goes stale after async image loads | `MarkdownPreview.tsx:952-1013` | also observe the inner body's height |
| `boot.ts` is dead code superseded by `useFileSession` boot logic | `src/utils/boot.ts` | delete to avoid drift |
| Recents in palette don't existence-check (Welcome screen does) | `App.tsx:1404-1417` | reuse the Welcome probe |
| Split-ratio persisted to localStorage on **every** pointermove during drag | `App.tsx:171, 1717`, `SplitDivider.tsx:30-33` | mirror `PanelResizeHandle`'s onResize/onCommit |
| Number field in frontmatter card: clearing sets value to `0` | `MarkdownPreview.tsx:511-515` | `Number("") === 0` guard |
| Settings search box: typing "accent" hides the Accent section; no cross-section results, no empty state | `SettingsModal.tsx:209, 271-441` | give settings ids+keywords, filter a flat list |
| Theme/font/size tables duplicated in 4 files and already drifting | `SettingsMenu.tsx:5-27`, `SettingsModal.tsx:43-67`, `ThemeContext.tsx:5-33`, `fontFamily.ts:5-19` | single exported source of truth |
| No `prefers-color-scheme` default (stale comment in `index.html:19` claims one exists) | `ThemeContext.tsx:72-78` | first run: follow OS |
| Zen exit stomps a mode change made inside Zen | `App.tsx:944-962` | restore only if untouched |
| Ctrl+P in-file ":"-style go-to-line missing (Ctrl+G unbound) | `keybindings.ts` | add `gotoLine` binding |
| ErrorBoundary is root-only; "Try Again" re-throws in place; no copy-error button | `main.tsx:19-25`, `ErrorBoundary.tsx:31-33` | nested boundary around the editor; copy-details button |
| Mobile: AI completely unreachable (settings hidden + disabled by default) though AIPanel has mobile-aware CSS | `SettingsModal.tsx:238-239, 446` | allow enabling AI on mobile |
| Mobile menu closes on `mousedown` only (fast-tap can suppress synthetic mouse) | `MobileTopBar.tsx:86-92` | use `pointerdown` |
| Update check has no opt-out setting | `UpdateDialog.tsx:105-118` | add a settings row |
| Video/audio files render as broken `<img>` (MIME map image-only) | `MarkdownPreview.tsx:239-247` | emit `<video>`/`<audio>` for known MIME |
| In-app `Ctrl+P`(rint) has no print CSS — prints the whole editor UI | `src/index.css` | add `@media print` (export CSS already has one to copy) |

---

## 4. Your graph question, answered in full

**Are the graphs zoomable today?** No. Verified in code (`MermaidBlock.tsx`, 134 lines) and live (ctrl+wheel does nothing, no buttons, no fullscreen):

| Capability | Paperling today | Obsidian |
|---|---|---|
| Zoom (wheel/pinch/buttons) | ❌ none | ✅ ctrl+scroll + buttons |
| Pan | horizontal scroll only | ✅ free pan |
| Fullscreen / larger view | ❌ | ✅ |
| Syntax error | error card with message (decent) | similar |
| Theme follow | ✅ re-renders on theme change | ✅ |
| Perf | LRU SVG cache (64, keyed theme+code) — good | similar |

**Compounding problem:** `.mermaid-rendered > svg { width:100%; max-width:none !important }` (`src/index.css:1170-1174`) stretches every diagram to the full column width. My 4-node test flowchart rendered ~1300px wide — labels huge, diagram taller than the viewport, and no way to shrink or zoom it. Two users problems in one: oversized *and* un-zoomable.

**Recommended implementation (3-5h, high payoff):**
1. Wrap the rendered SVG in a transform wrapper: default `fit` = scale to natural size (read `svg.viewBox`) capped at 100% column width — this alone fixes the "everything is gigantic" problem.
2. `ctrl+wheel` → scale (clamp 0.25–4), `pointerdown+drag` → pan when scaled, `dblclick` → reset.
3. Floating mini-toolbar on hover: `+` / `−` / `⤢` fullscreen / `fit`. Reuse the existing lightbox machinery (`MarkdownPreview.tsx:1101-1123`) for the fullscreen overlay (add focus trap + scroll lock there too — it currently has neither).
4. Cache the *unscaled* SVG string (you already do) and apply scale via CSS transform so theme/`viewBox` handling stays untouched.

**While you're in there — the bigger "graph" gap for the Obsidian league:** there is no **graph view** (note-link topology). That's a big lift (canvas/WebGL, layout, bloom filtering) and fine to defer, but a cheap v1 is possible later because backlinks data already exists (`find_backlinks` in `src-tauri/src/commands.rs:576-925`): a simple force-directed local graph (current note + 1 hop) on the backlinks panel would be a signature feature for a fraction of Obsidian's global graph.

---

## 5. Missing features vs Obsidian & the leading tools (ranked by impact)

**Tier 1 — felt immediately by anyone coming from Obsidian/VS Code:**

1. **File management** — the explorer is read-only drill-down: no create/rename/delete/move, no context menu, no tree (flat per-folder), no sorting; it even hides `.txt` files that the Open dialog accepts (`FileExplorer.tsx`; backend `src-tauri/src/lib.rs:131-150` has zero file-mutation commands). This is the single biggest "can't live in this app" gap.
2. **Open-folder workspace (vault)** — the explorer/search root is always the current file's directory. No "open folder", no tree, no multi-root. Recents+tabs are the only memory.
3. **Real file watcher** — external changes are detected only on window *focus* via mtime stat (`useExternalChangeWatcher.ts:69`). No `notify` crate anywhere in src-tauri. A sync client changing a file while you work in another window is invisible until alt-tab (and then see bug 3.1).
4. **Global Search & Replace** — search is search-only (`commands.rs:543-640`), no replace-all, no regex/whole-word filters, no stay-open results (see 3.16).
5. **Hot exit / crash recovery** — session persists `{path, cursorLine}` only (`persistence.ts:88-107`); unsaved buffer text is never persisted anywhere. Crash/OSError-update reboot = every unsaved edit gone, including untitled buffers.
6. **Keybinding customization UI** — `keybindings.ts` is a great central config with aliases and display strings; only the override map + capture-input UI is missing. Highest-leverage settings feature you can add.

**Tier 2 — the "power user staples":**

7. Editor display options: line-number toggle, relative numbers, readable line length (editor spans full width always), indent size (hardcoded 2 spaces, `editorActions.ts:21`), indent guides, active-line toggle, autosave interval (fixed 1.5s). Compartments for wrap/spell/vim already exist (`CodeEditor.tsx:448-460`) — each new option is ~1h following that pattern.
8. Missing editing commands (all near-free via CM built-ins): delete line (`Ctrl+Shift+K`), move line up/down (`Alt+Up/Down`), duplicate line, insert line below (`Ctrl+Enter`), select next occurrence (`Ctrl+D` — `selectNextOccurrence` ships in the already-bundled `@codemirror/search` which is otherwise unused), toggle heading `Ctrl+1..6`, toggle task `Ctrl+L`, fold/unfold, go-to-line, highlight-selection-matches (same unused dep).
9. Quick switcher over all files (fuzzy) + palette mode prefixes (`>` commands, `@` symbols, `#` tags) + recent-commands ranking. Palette fuzzy scoring is naive (`CommandPalette.tsx:81-98`): `indexOf`-based, no word-boundary/camelCase bonuses, greedy subsequence without backtracking, multi-term AND fails ("fil new" finds nothing).
10. Side-by-side split of **two different files** (split is editor+preview of the same doc), pinned tabs, tab drag-out into split.
11. Obsidian-flavored markup: callouts `> [!NOTE]` (the slash menu *offers* "Callout" but the preview renders a plain blockquote — the menu sells something the app doesn't do), `#tag` rendering/clicking, `%%comments%%`, emoji shortcodes, `[toc]`, `![[image]]`/`![[note]]` (see 3.24), `<details>` with parsed markdown inside.
12. Breadcrumbs beyond one non-clickable parent (`TitleBar.tsx:105-115`), status-bar encoding/EOL indicator + conversion (a Latin-1 file currently fails `read_to_string` with a raw error, `commands.rs:270-271`), file size/path on hover.

**Tier 3 — ecosystem & platform:**

13. Custom themes / CSS snippets (the #1 Obsidian ecosystem hook; a theme-JSON import or `snippets/` folder is enough v1).
14. Workspace layout persistence (open panels + sizes + per-tab mode; today only `splitRatio` and AI width persist — `App.tsx:201-204` panels are plain `useState(false)`; left drawer isn't resizable at all).
15. Daily notes + templates (core PKM workflows; zero code exists).
16. Sync story (even just "watch a folder the user syncs with their own cloud" — but fix 3.1 + add the watcher first).
17. Plugin/API surface — fine to defer, but it's Obsidian's actual moat; put it on the roadmap explicitly.
18. UI zoom (`Ctrl+=`/`Ctrl+-`) — webview zoom handler; an accessibility gap too.

**Mobile:** no gestures (swipe between tabs, swipe-to-close sheets, long-press menus), split unreachable on tablets (iPad is detected as mobile → single-pane wastes the screen), AI unreachable (see 3.27).

---

## 6. UX / UI polish list (expert-eye items)

1. **Mode toggle floats bottom-right over content** — in reader/split it overlaps the preview's bottom-right corner (screenshot-verified). Move into the status bar or fade it out until hover.
2. **Callout in slash menu vs plain rendering** — ship callout CSS+parser (tier-2 #11) or remove the menu item until it's real; right now the feature list lies to new users in their first minute.
3. **Mermaid edge-label boxes and glow** in dark themes look clunky (screenshot-verified); the fit-to-natural-size fix (§4) plus `securityLevel: strict` theme tuning will clean most of it.
4. **Welcome screen is empty on first run** — add the interactive-guide CTA + tour button there (per settings-audit X5: the tour only auto-starts once a buffer is open, and nothing on the welcome screen invites either).
5. **Tour final button "Open the guide"** is great, but finishing the tour right after "New File" (the exact first-run path) drops users into split view of a *dirty-marked* guide tab (3.8) — first-impression roughness.
6. **Editor font-size setting that doesn't affect the editor** (3.29) — plus add ≥5 size steps or a slider (Obsidian goes to 32px).
7. **Status bar richness** — cursor line:col exists in code/split; add save-state per tab, encoding/EOL, and make "N words / <1 min read" click open the existing Stats dialog (discoverability).
8. **Find bar** — remember last query/options, Esc closes from editor, seed from selection, Enter-in-replace replaces (all detailed in 3.29).
9. **Palette** — Tab-to-complete, PageUp/PageDown, don't let hover steal the active row (`CommandPalette.tsx:258`).
10. **Zen top bar** — reveal on focus-within, not just hover (a11y + discoverability; F9-exit is only discoverable via cheatsheet).
11. **Settings search** — make it actually search across sections with an empty state (3.29).
12. **No-AI empty state** is good; add the provider-pills to it so first-time setup is 2 clicks from the panel itself.
13. **Window title** shows file + dirty bullet — good; also show the section anchor after scrolling (cheap nicety, Obsidian does it).

---

## 7. Shortcuts — full recommendations

Current state is strong (central config, platform-correct primary modifier, cheatsheet derives from config). Gaps:

**Add (map to CM built-ins where possible — see §5 item 8):**
| Action | Proposed |
|---|---|
| Delete line | `Ctrl+Shift+K` |
| Move line up/down | `Alt+Up/Down` |
| Duplicate line | `Shift+Alt+Down` |
| Insert line below | `Ctrl+Enter` |
| Select next occurrence | `Ctrl+D` |
| Toggle heading 1-6 | `Ctrl+1..6` |
| Toggle task/checkbox | `Ctrl+L` |
| Go to line | `Ctrl+G` + palette `:` prefix |
| Fold / unfold all | `Ctrl+Shift+[` / `]` |
| Paste plain text | `Ctrl+Shift+V` |
| Cheatsheet (works in editor) | `Ctrl+Shift+/` (see 3.6) |
| UI zoom | `Ctrl+=` / `Ctrl+-` |

**Fix platform breakage:** macOS Alt+Arrows (3.3), Linux Ctrl+J (3.4), `defaultPrevented` guard (3.3) — these three changes make every existing shortcut trustworthy.

**Then ship the customizer** (§5 item 6): override map persisted to localStorage, merged in `matchesBinding`; "Hotkeys" section in Settings listing `formatShortcut` rows with a capture input; conflict detection against the existing aliases table. The infra is genuinely one day of work.

---

## 8. Performance notes (for the big-doc future)

- **Per-keystroke O(document) copies on hot keys**: every Enter/Tab/Ctrl+B does `doc.toString()` + full-string diff (`toEdState`/`applyResultToView`, `CodeEditor.tsx:152-155, 483-488`) — the codebase's own comments call this pattern out elsewhere; Enter/Tab should go CM-native.
- **Preview re-renders whole tree per debounced tick**: no block-level memoization, so a 10k-line doc reparses everything per pause. The `data-source-line` infra already gives block mapping — per-block memo is the Obsidian-style fix. Also `extractCodeChild→nodeText` walks the entire highlighted React tree of every code block each render just to check for `language-mermaid` (`MarkdownPreview.tsx:382-396`) — cache on the hast node.
- **Mermaid**: no in-flight dedupe + no concurrency cap — N large diagrams = N simultaneous main-thread `mermaid.render` calls (freeze while typing). Queue renders.
- **Image blob cache**: 100 entries × 25MB cap = ~2.5GB worst case, never cleared on file close (`MarkdownPreview.tsx:256-283`) — add a byte budget or clear on `filePath` change.
- **Split-drag** writes localStorage per pointermove (3.29).
- **Vitest**: 51 jsdom environments created, 227s of 54s... i.e., the suite spends most of its wall-time creating environments — `pool: 'vmThreads'` per the output would cut CI time ~4x. (Noted by the runner itself.)

---

## 9. Suggested order of attack (first two weeks)

**Day 1 — trust & safety (all small):**
1. Background autosave mtime guard (3.1)
2. `handleAutosaved` path check (3.20)
3. `clearReview()` in `loadFileDirect` (3.17)
4. Conflict-dialog Escape → cancel (3.18) + "Save all" guard (3.19)
5. `defaultPrevented` guard + macOS/Linux shortcut fixes (3.3, 3.4)

**Day 2 — one-liners with outsized feel:**
6. Tab-destroys-selection (3.12), code-block caret +5 (3.29), table caret 11→10 (3.29), table-EOF row (3.29), Unicode slugify (3.25), TOC fence skip (3.21), image error state (3.5), anchor preventDefault (3.22)

**Week 1 — the two flagship fixes:**
7. Mermaid zoom/pan/fit/fullscreen (§4)
8. Find/Replace stale-offset fix + advance (3.2) + GlobalSearch stay-open (3.16)

**Week 2 — features that change retention:**
9. Hot exit (§5 #5)
10. Explorer create/rename/delete (§5 #1)
11. Global search replace + regex/word filters (§5 #4)
12. Keybinding UI (§5 #6)
13. Slash-menu completion-source rework (3.7)

---

## 10. Appendix — test-environment notes (so you can reproduce)

- Dev server: `node node_modules/vite/bin/vite.js --port 5273` (plain `npx vite` fails on this machine: `npm error EOVERRIDE` — the `@codemirror/view` override in package.json conflicts under npm's resolver; the project is bun-managed via `bun.lock`. Consider documenting `bun dev` as the only supported path, or aligning the override).
- Browser-mode caveats (not bugs, but explains differences you'll see vs the packaged app): no Tauri → file dialogs/native FS/updater unavailable; explorer shows "Folder is empty"; title-bar window controls render but are inert.
- One transient during testing: finishing the tour appeared to "reset" the app — traced to an HMR update of `WelcomeScreen.tsx`/`App.tsx` triggered while auditing (dev-server file watch), not an app bug.

*— End of report. The server is still up on :5273 if you want to click around.*
