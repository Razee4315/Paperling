# ✅ Verification Checklist — branch `fix/audit-pass-2026-09-21`

*Everything below is implemented on this branch and covered by 511 passing tests. Tick each one as you try it.*

## 💾 Data safety (the big one)
- [ ] **External changes are never overwritten.** Open a file, edit it, switch to a second tab, edit the file from outside (Notepad), then come back within ~2s. Paperling *pauses* instead of overwriting: you get a warning toast, and switching to that tab shows the conflict dialog.
- [ ] **Conflict dialog is safe now.** Pressing **Escape** on the conflict dialog does *nothing* (it used to pick "keep mine" and arm an overwrite). There's a new **"Save a copy…"** button — use it to keep both versions.
- [ ] **Close is refused while a conflict is open.** With a conflicted tab, close the window → "Save all" refuses and tells you to resolve first.

## 📊 Mermaid diagrams (zoom!)
- [ ] Paste a ` ```mermaid ` diagram. Small diagrams now render at **natural size** (no more giant stretched flowchart).
- [ ] Hover the diagram → toolbar with **− / 100% / +**. Click + a few times → diagram grows; the % updates.
- [ ] **Ctrl + mouse wheel** over the diagram zooms in/out.
- [ ] While zoomed: **drag to pan**, **double-click** toggles 1×/2×.
- [ ] Click the **⛶ fullscreen** button → big overlay view; **Escape** exits.

## ⌨️ Editor
- [ ] Select a word, press **Tab** → the line indents and the selection is **kept** (it used to be deleted).
- [ ] Type `1. one` ⏎ `2. two` → go to the end of line 1 → **Enter** → inserts `2. ` **and renumbers** the old `2. two` to `3. two`.
- [ ] Type `/task` **fast, in one go** → the slash menu now opens (it used to fail on fast typing).
- [ ] Select `**bold**` (markers included), press Ctrl+B → it **unwraps** (no more double-bold).
- [ ] Format toolbar → Code block button → caret lands **inside** the fence, not on it.

## 🔍 Find & Replace + global search
- [ ] Ctrl+F → search something → **Replace** repeatedly: it replaces and **advances to the next match** (VS Code style), and rapid replaces no longer corrupt text.
- [ ] Click into the **Replace** field, press **Enter** → it *replaces* (Enter in the find field still = next match).
- [ ] Close find, reopen: your query / case / regex settings are **remembered**.
- [ ] **Ctrl+Shift+F** → search the folder → click results: the panel **stays open** so you can hop through matches; arrow keys scroll the active row into view.
- [ ] New: type a "Replace with…" value → **Replace all in files…** → Confirm → every matched file is rewritten, and your open tab refreshes if it was one of them.

## 🖼️ Preview & paste
- [ ] Paste text **from Excel/Google Sheets** → it becomes a markdown **table** (it used to flatten into garbage).
- [ ] **Ctrl+Shift+V** pastes as plain text (no HTML conversion).
- [ ] An image link that can't load (e.g. `![x](broken.png)`) shows a **"Failed to load image"** card instead of a pulsing skeleton forever.
- [ ] `[[wikilinks]]` inside code blocks stay as **plain text** (no more corrupted code/Copy button).
- [ ] `![[image.png]]` embeds resolve next to the file.
- [ ] Headings in other languages (e.g. `## 简介`) get real anchors; links like `[跳转](#简介)` work.
- [ ] Clicking a relative link like `[report](report.pdf)` **stays in the app** (used to blank the whole window).
- [ ] The outline (Ctrl+Shift+O) **ignores** `# comments` inside code fences.

## 📤 Export
- [ ] Export a document containing math ($E=mc^2$) as HTML/PDF → formulas render **correctly** (KaTeX styles are now included).
- [ ] Type something and export immediately → your last keystrokes are **included** (capture waits for the preview).

## ⌨️ Shortcuts & platform fixes (Mac/Linux users)
- [ ] macOS: **Option+←/→** moves by word only (no more tab switching at the same time). Windows/Linux: **Alt+←/→** switches tabs as before.
- [ ] Linux: **Ctrl+J** opens the AI assist (was advertised but dead).
- [ ] vim mode: Enter/Tab/Ctrl+W behave like vim again (no more newline insertions or closed tabs).

## 🌙 Session & crash safety
- [ ] Type in an untitled buffer **without saving**, kill the app (Task Manager / close the window), reopen → a toast says **"Recovered 1 unsaved buffer…"** and your text is back.
- [ ] The interactive guide (from the tour or command palette) opens **without** an "unsaved changes" dot on its tab.

## ♿ Accessibility & polish
- [ ] Open Settings (Ctrl+,) → keyboard focus lands in the **search box**, and Tab stays *inside* the dialog.
- [ ] Theme tiles show a pressed state to screen readers (`aria-pressed`).
- [ ] Zen mode (F9): press **Tab** → the hidden top bar appears (you can reach the exit by keyboard).
- [ ] Status bar reads "N **words**" to screen readers (it said "characters").

## 🧪 For you, the developer
- [ ] CI/test-build green on GitHub Actions
- [ ] 511/511 unit tests pass locally (`bun run test`)
- [ ] Full details for every change: `WAKEUP_REPORT.md` (§ "Implementation Status")
