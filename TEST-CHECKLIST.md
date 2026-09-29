# ✅ Shortcuts settings + the "?" cheatsheet speak Chinese (branch `fix/i18n-shortcuts-2026-09-29`)

*The dictionary already had every `shortcuts.*` string — the hint, 全部恢复默认, every row name and group heading — but `ShortcutSettings.tsx` and `ShortcutCheatsheet.tsx` still hard-coded English, so those translations were dead and both screens stayed English while the rest of the app followed the language setting. Both now read the dictionary (same entries as each other, so a command can never be named two different things). 648 passing tests. Details: I18N-01.*

## ⌨️ Settings → Shortcuts
- [ ] Set the language to **简体中文** (Settings → 外观 → 语言), open **快捷键**. The hint reads **点一下某个快捷键，然后按下新的组合键。按 Esc 取消。**, the button is **全部恢复默认**, and the headers are **文件与标签页 / 视图与导航 / 编辑**.
- [ ] Every row is Chinese: **新建文件, 打开文件, 保存, 另存为, 关闭标签页, 重新打开已关闭的标签页, 下一个标签页, 上一个标签页, 命令面板, 跳转到行, 切换阅读／代码, 切换分栏视图, 禅模式, 全屏, 文件面板, 大纲, 在文件中搜索, 设置, 加粗, 斜体, 插入链接, 切换引用, 查找, 查找和替换, 选中下一个匹配项, 切换任务复选框, 返回（跟随链接后）, 前进**. The shortcut chips (Ctrl+N, …) stay as keys.
- [ ] Click a shortcut (it shows **请按按键…**) and press a combo another command owns, e.g. **Ctrl+S** on 新建文件: the error names the owner in Chinese (**Ctrl+S 已被"保存"占用**). Press a bare letter instead: **请使用修饰键（Ctrl、Alt、⌘…）或功能键**.
- [ ] With the panel open, switch the language back to **English**: every string above flips back live, and an on-screen error flips with it (no stale language).
- [ ] **Settings search** still works in both languages: typing `bold` and typing `加粗` both leave only the 加粗 row.

## ⌨️ The "?" cheatsheet (its own screen — previously always English)
- [ ] Press **?** in 简体中文. The dialog title is **快捷键**, the filter box says **筛选快捷键…**, the sections are **文件 / 标签页 / 视图 / AI / 编辑器：格式 / 编辑器：导航 / 编辑器：自动配对 / 斜杠与智能粘贴**, and the footer reads **按 Esc 关闭**.
- [ ] Filter with Chinese (e.g. `加粗`) and with an English word (e.g. `bold`): both narrow the list. A search that matches nothing shows **没有匹配"zzz"的快捷键**.
- [ ] Switch the language while the dialog is open: labels follow.
- [ ] Back in **English**, the cheatsheet reads exactly as before (Keyboard Shortcuts, File & tabs wording is unchanged there).

## 🔍 Still English (known, tracked — not part of this fix)
- [ ] The **AI panel / AI bubble, Mermaid diagram controls, the in-document find/replace bar (Ctrl+F), the welcome screen, the tour, the slash menu and the conflict dialog** are still English. They have **no entries in the dictionary yet**, so translating them is a copy-writing task (new source strings), not a wiring bug like this one was.

---

# ✅ Local build without the updater key (branch `chore/local-build-script`)

*`bun run tauri build` wrote both installers and then failed anyway — "A public key has been found, but no private key" — with exit code 1, on every machine that has the updater public key but not the private one. New `bun run build:local` merges `src-tauri/tauri.local.conf.json` (`createUpdaterArtifacts: false`) so a local or scripted build finishes cleanly. Releases are untouched and still sign. Details: BLD-01.*

- [ ] In PowerShell, from the repo root: `bun run build:local`. It ends with `Finished 2 bundles` and prints **no** "no private key" line.
- [ ] `$LASTEXITCODE` right after it is **0**. Before this change the same build exited **1** even though the installers existed, so any script or CI step keyed on the exit code looked like it had failed.
- [ ] Both installers are freshly written: `src-tauri\target\release\bundle\msi\Paperling_1.0.51_x64_en-US.msi` (~15.5 MB) and `...\bundle\nsis\Paperling_1.0.51_x64-setup.exe` (~13.7 MB). Install the `.exe` over your current copy and open a note to confirm the bundle is a normal working build.
- [ ] **Regression check:** plain `bun run tauri build` must behave exactly as before — both installers, then the "no private key" error and exit 1, and **no** `.sig` files next to them. If it ever starts succeeding without a key, that means release signing got disabled — tell me.
- [ ] Nothing else moved: `git status` in the working copy shows only your own uncommitted files, and `bun run test` is green.

---

# ✅ Chinese interface + language setting (branch `fix/img-04-relative-image-paths`)

*New: the app speaks Chinese, and Settings → Appearance → 语言 switches language live. 637 passing tests. Details: I18N-01.*

## 🌏 Language (try this first)
- [ ] Open **Settings (Ctrl+,)**. The first row of **外观** is **语言**, with the hint "界面按钮、菜单和提示所使用的语言。你的笔记内容不会被翻译。"
- [ ] Three options fit on the row and all are clickable: **跟随系统（简体中文）** (highlighted, because this PC is Chinese), **English**, **简体中文**. If a label is cut off, that's a bug — tell me.
- [ ] Click **English**: the whole panel, the sidebar (Appearance / Editor / Shortcuts / AI / About) and the window behind it become English **immediately** — no restart, no flash of the old language.
- [ ] Click **简体中文**: everything goes back to Chinese.
- [ ] Close and reopen the app: the language you picked is still in effect. (The choice is per-user, stored with the other settings.)
- [ ] Pick **跟随系统** and restart: the app follows Windows' own language again.
- [ ] **Search in settings** works in both languages: type `主题` or `theme` — both find the theme row; `拼写` or `vim` both find the editor rows.
- [ ] A **toast** is translated: press Ctrl+S (or open a missing file) and read the notification in the bottom corner.
- [ ] The **file explorer** (Ctrl+Shift+E) and the **outline** (Ctrl+Shift+O) are Chinese, including the right-click menu (打开 / 重命名 / 移到回收站) and the empty states.

## 🔍 What is still English (known, tracked — not a bug)
- [ ] The keyboard cheatsheet remains English — that's the one remaining screenful.
- [ ] The AI panel, the Mermaid diagram controls, the find/replace bar and the export/PDF labels are still English.
- [ ] Anything else you spot: note the exact wording and where it was; the dictionary makes each one a small local fix.

## 🔎 Sanity (nothing else broke)
- [ ] A note with a **Chinese image path** still renders its images.
- [ ] **Export → HTML/PDF** still works.
- [ ] Switch language with unsaved edits in a tab: nothing is lost, the tab keeps its dirty dot.

---

# ✅ Images with non-ASCII paths (branch `fix/img-04-relative-image-paths`)

*A markdown image whose path contains a Chinese character, a space or `#` never loaded — the parser hands the preview an encoded URL (`%E7%AC%AC01...`) and it was passed to the file reader verbatim, so the file it asked for did not exist. Now decoded first. 612 passing tests. Details: IMG-04.*

- [ ] Open `data/chem_doc/第01章_化学计量_融合版.md` in **Reader**. Every diagram shows — including the ones inside table rows and mid-sentence, and the 图2-1 flask near the end. Before this fix each one read "Failed to load image".
- [ ] Open any other chapter (05, 12 and 17 have the most images). Same result: pictures, not error boxes.
- [ ] Click an image: the zoom lightbox opens on it.
- [ ] **Export → HTML** and **PDF** on a chapter with images: the pictures are in the export too (they are embedded from what the preview loaded).
- [ ] Files that were fine before are still fine: an English-path image, a `https://…` image, and an image pasted from the clipboard still render.
- [ ] `data/chem_doc/第04章_非金属及其化合物_融合版.md` still shows 3 error boxes ("…image-2026060821…png"). That is expected — those 3 files are genuinely absent from the folder (they point at a `…第1节_氯及其化合物.assets/` folder that isn't there).
- [ ] Sanity: a note containing `![x](../../../etc/passwd)` still refuses to load it.

---

# ✅ Community issues (branch `feat/community-issues-2026-09-26`)

*Fixes for issues reported by users: #216 (RTL), #206 (window controls in Zen), #212 (package managers). 609 passing tests.*

## 🔤 Right-to-left text (#216) — try these first
- [ ] Open a note and type an Arabic (or Hebrew/Persian/Urdu) line. That line **starts from the right** in the editor; English lines stay on the left.
- [ ] Same note in **Reader** and **Split**: Arabic headings/paragraphs are right-aligned, bullets sit on the right, a quote's bar is on the right, table columns run right-to-left.
- [ ] A code block inside Arabic text still reads left-to-right (`const x = 1;`, not `;const x = 1`).
- [ ] In the editor press **Ctrl + Right Shift** (press both, release, nothing else): every line goes right-to-left and a message says so. **Ctrl + Left Shift** goes back to automatic.
- [ ] Ctrl+Shift+F / Ctrl+Shift+V still do their normal thing and do **not** change the direction.
- [ ] **Settings → Editor → Text direction**: Auto / LTR / RTL switch the editor and the reader live, and the choice survives a restart.
- [ ] Export an Arabic note to **HTML** and **PDF**: it's right-to-left there too.
- [ ] An English-only note looks exactly like before (nothing moved).

## 🪟 Zen mode window controls (#206)
- [ ] Press **F9** (Zen). The top bar with **minimize / maximize / close** shows for ~4 seconds, then hides. The message mentions "Window controls: top edge".
- [ ] Close the app while in Zen and reopen it. The top bar shows for a few seconds again (before, there was no visible way to move or close the window).
- [ ] After it hides, move the mouse to the very top edge: the bar comes back; drag it to move the window, double-click to maximize.

## 📦 Package managers (#212)
- [ ] `packaging/winget` and `packaging/scoop` now point at **v1.0.50**; `packaging/homebrew/paperling.rb` is new. Submitting them is on you (see `packaging/README.md`).

---

# ✅ Round 4: the everyday flows (branch `fix/audit-round4-core-flows-2026-09-26`)

*The things you do every day, made to feel like Obsidian/Typora. 574 passing tests. Details: `AUDIT_2026-09-26.md`.*

## 📖 Reading ↔ editing (try these first)
- [ ] Open a long note in **Reader**, scroll halfway, press **Ctrl+E**. The editor opens **at the same paragraph** (it used to jump to line 1), and you can type immediately.
- [ ] Scroll somewhere in the editor, then press **Ctrl+E**. Reader opens at the same place.
- [ ] **Split view** (Ctrl+\\): scroll either side past images, tables or code blocks. The other side stays on the **same paragraph** (it used to drift).
- [ ] Open a big note (a long README, 100 kB+) in split view and type. The preview keeps up without freezing. In code mode, typing never stutters.

## 🗂️ Tabs
- [ ] Open 3–4 long notes, scroll each somewhere, then flick between tabs (click, Ctrl+Tab). Each tab appears **already at its place**: no flash of other text, no jump.
- [ ] Open the file panel (Ctrl+Shift+E): the tabs move over beside it, and the first tab is fully visible. Many tabs: no scrollbar covering the tab labels.
- [ ] With the file panel open, switch to a tab from a **different folder**: the panel follows to that folder and highlights the note, without flickering.
- [ ] In a note, put the caret mid-line far down, type something, switch to another tab and back. The caret, the scroll position **and Ctrl+Z** all still work.
- [ ] Press **New File**, then open a file right away. No leftover empty "Untitled" tab.
- [ ] Double-click the empty part of the tab strip to get a new tab.
- [ ] Right after launching (while your last session is still loading), press Ctrl+N and type. Your text is **never** lost when the old tabs appear.

## ✨ Smoothness pass (round 4b)
- [ ] Reader → **Ctrl+E** on a part of the note with a **table or code block**: the editor opens at that same table/code (it used to jump near the top).
- [ ] Reader → Ctrl+E: no one-frame flash of the top of the note before it lands.
- [ ] In Reader, **double-click a word**, then press Ctrl+E: that word is selected in the editor.
- [ ] Click a tab and start typing right away: the text goes into the note (before, typing went nowhere and Backspace **closed the tab**). After Ctrl+W, you can type in the next note immediately.
- [ ] Type the first letter in a saved note: the toolbar (New / Open / Edit / Export) and the other tabs **don't shift** sideways.
- [ ] **Ctrl+S**: no popup over the text; the status bar's "Saved" flashes instead.
- [ ] Scroll to the very end of a note: the last line is readable above the Reader/Split/Code pill.
- [ ] Split view with the file panel open: drag the divider and it stays under the mouse. Double-click the divider to reset it to 50/50.
- [ ] Open files quickly: no full-window "Loading..." blur flashing.
- [ ] Follow a `[[link]]`, then press **Ctrl+Alt+←** (or the mouse back button) to go back. Ctrl+Alt+→ goes forward again.
- [ ] Close the last tab with the file panel open: the welcome screen sits beside the panel, not under it.

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
