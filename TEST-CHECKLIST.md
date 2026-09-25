# ✅ Round 4: the everyday flows (branch `fix/audit-round4-core-flows-2026-09-26`)

*The things you do every day, made to feel like Obsidian/Typora. 574 passing tests. Details: `AUDIT_2026-09-26.md`.*

## 📖 Reading ↔ editing (try these first)
- [ ] Open a long note in **Reader**, scroll halfway, press **Ctrl+E**. The editor opens **at the same paragraph** (it used to jump to line 1), and you can type immediately.
- [ ] Scroll somewhere in the editor, then press **Ctrl+E**. Reader opens at the same place.
- [ ] **Split view** (Ctrl+\\): scroll either side past images, tables or code blocks. The other side stays on the **same paragraph** (it used to drift).
- [ ] Open a big note (a long README, 100 kB+) in split view and type. The preview keeps up without freezing. In code mode, typing never stutters.

## 🗂️ Tabs
- [ ] In a note, put the caret mid-line far down, type something, switch to another tab and back. The caret, the scroll position **and Ctrl+Z** all still work.
- [ ] Press **New File**, then open a file right away. No leftover empty "Untitled" tab.
- [ ] Double-click the empty part of the tab strip to get a new tab.
- [ ] Right after launching (while your last session is still loading), press Ctrl+N and type. Your text is **never** lost when the old tabs appear.

## ✏️ Lists and tasks
- [ ] `- first` ⏎ `second`, then press **Tab**: the item becomes nested (`  - second`). **Shift+Tab** brings it back.
- [ ] In `1. one` ⏎ `2. two`, Tab on "two" makes a proper nested `   1. two`.
- [ ] Click right after `- [ ] ` on a task that has text and press **Enter**. A new task appears above; nothing is deleted (it used to delete the checkbox).
- [ ] Enter on an empty **nested** bullet steps out one level instead of ending the list.
- [ ] **Ctrl+Enter** on a line: it becomes a task, then ticks, then unticks.
- [ ] Reader: a list mixing normal bullets and `- [ ]` tasks shows **all** its bullets. Done tasks look greyed/struck.

## 🔍 Find
- [ ] Select a word, press **Ctrl+F**: it's already in the box.
- [ ] Press Enter a few times, then **Esc**: you're on the found word, and typing replaces it.
- [ ] With the find bar open, click in the text and press Ctrl+F again: the cursor goes back to the find box.

## 🔗 Links & outline
- [ ] In the editor, **Ctrl+click** a `[[wikilink]]` or a URL: it opens (for a URL, in your browser).
- [ ] `[[Other note#Some heading]]` to a note that's **already open** jumps to that heading.
- [ ] Outline (Ctrl+Shift+O): headings show clean text (no `**`, no `{#id}`), and `Title` + `====` headings appear. Click one: the caret lands there and you can type straight away.
- [ ] With the outline open, press Esc in the editor: the outline stays open. Press Esc inside the outline: it closes.

## 💾 Saving
- [ ] New file, type `# Trip plan`, press Ctrl+S. The dialog suggests **"Trip plan.md"** in the folder you last used.
- [ ] Close a tab with unsaved edits: the prompt names the file.
- [ ] Export → HTML right after typing: the last words you typed are in the file.

## 🧪 For you, the developer
- [ ] `node node_modules/vite/bin/vite.js --port 5391`, then open `http://localhost:5391/?fakefs=1&raf=1`: the whole app runs in a browser with a fake disk (see AUDIT_2026-09-26.md §4).
- [ ] CI green on the PR; Test Build artifacts downloaded and installed.

---

# ✅ Round 3 — branch `fix/audit-round3-2026-09-25`

*Everything here is new on this branch (515 passing tests). Details: `AUDIT_2026-09-25.md`.*

## 💾 Your work is safe (try these first)
- [ ] **Crash recovery sticks.** Type in a new note, kill the app from Task Manager, then reopen: the text is back and the tab shows the unsaved dot. Kill it again and reopen: **still back** (it used to vanish the second time).
- [ ] **"Don't save" means don't save.** Type something, close the window, choose Discard, then reopen: nothing is "recovered".
- [ ] **Other programs' edits are never overwritten.** Open a note, type, then save the same file in Notepad within 1–2 seconds. Paperling shows the "File changed on disk" dialog instead of overwriting. Ctrl+S does the same.
- [ ] While that dialog is open, press **Alt+→** or **Ctrl+Tab**: nothing happens (shortcuts are paused behind dialogs). Click another tab and wait 3s: Notepad's version is still on disk. Come back: the dialog is there again.
- [ ] **Keep my version** saves once, and the dialog doesn't come back.
- [ ] **Replace in files with the note open:** Ctrl+Shift+F, search a word that's in an open tab, and replace. The open tab shows the change (unsaved dot) and **keeps it**. Then click **Undo replace**: everything goes back.

## ⌨️ Things that were broken
- [ ] Type in a new note, then press **Ctrl+N**: a second tab opens (it used to do nothing).
- [ ] Write `Run the command /table later`, then click right after `/table`: **no** slash menu, and Enter just makes a new line.
- [ ] Windows: while typing, **Alt+←/→** switches tabs again.
- [ ] Hover a Mermaid diagram and click **+**: it zooms (it used to open fullscreen).

## ✨ New
- [ ] **Callouts:** `> [!WARNING] Careful` renders as an orange box; `> [!tip]- Folded` renders collapsed.
- [ ] **#tags** show as pills; click one to search the folder for it. `%%hidden%%` text disappears from the preview.
- [ ] **`[[Other note#Heading]]`** opens the note at that heading and shows as "Other note › Heading".
- [ ] **Multi-cursor:** select a word, press **Ctrl+D** a few times, and type: every copy changes.
- [ ] Select text and type `*` / `_` / `=` / `~`: the selection gets wrapped.
- [ ] **Ctrl+G** (or `:42` in Ctrl+P): go to line. **Ctrl+P** also lists every note in the folder (quick switcher), and "fil new" finds "New file".
- [ ] **Settings → Shortcuts:** click Bold, press Ctrl+Shift+Y, and it works in the editor right away. Trying a combo that's already used is refused with a message. Reset works.
- [ ] Settings search: type `vim` or `bold`, and it jumps to the right section.
- [ ] **Font size** (Settings → Appearance) now changes the editor too; there's a new Extra large step.
- [ ] **Readable line length** also centres the editor text.
- [ ] Diagram toolbar: **Copy as PNG** (paste into chat/docs) and **Save as SVG**.
- [ ] Ctrl+P → **Print…** prints the formatted document, not the app window.
- [ ] **File explorer** (Ctrl+Shift+E): New note, New folder, F2 to rename (the open tab follows), and Delete to move to `.trash` (nothing is permanently deleted). `.txt` notes are listed too.
- [ ] Folder search: the new **ab** (whole word) toggle; `.txt` files are searched too.
- [ ] A note saved by Notepad **with a BOM** shows its frontmatter card normally, and saving keeps the file byte-identical.
- [ ] macOS/Linux: saving a note through a symlink keeps the symlink.

## 🧪 For you, the developer
- [ ] The Test Build workflow compiled the new Rust commands (link in the hand-off message).
- [ ] When you open a PR, CI runs the new `cargo test` cases (unique temp names, explorer ops, whole-word search, symlink saves).

---

# ✅ Verification Checklist — branch `fix/audit-pass-2026-09-21`

*Everything below is implemented on this branch (516 passing tests). Tick each one as you try it.*

## 🆕 Round 2 — from your Test Build feedback

- [ ] **Chemistry renders now.** A `$$` block with the mhchem command shows proper book-style chemistry (subscripts, arrow) — no more red raw text. Root cause: two different KaTeX versions were installed; mhchem patched one while the other did the rendering.
- [ ] **Mermaid zoom no longer jumps to 200%.** Click the − or + button twice quickly: it steps smoothly (100% → 81% → 64%) instead of snapping to 200%.
- [ ] **Graphite / Nord / Midnight diagrams are readable.** Switch to any dark theme: diagram labels/legends are light-on-dark, not near-black on black.
- [ ] **Readable line length toggle** (Settings → Editor, ON by default): the preview shows a centered ~800px column, Obsidian-style. Turn it OFF: the preview fills the window. The choice persists across restarts.
- [ ] **Zen mode (F9) got real features:** hover the top edge — the bar now has Outline, New file, and Open file buttons; the outline overlay works inside zen.
- [ ] **Mobile settings scroll.** On a phone, Settings now scrolls — the custom-font area is reachable (before, everything below the fold was cut off).
- [ ] **Font suggestions.** Tap the "Custom system font" input: your installed fonts appear as you type (native dropdown arrow). Nothing is probed until you touch the input, and the result is cached for the session. Some browsers prompt for font access once; it falls back gracefully if denied.

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
