# Changelog

All notable changes to Paperling will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.50] - 2026-09-11

### Added

- **Paperling for Android.** The full app, rebuilt for touch: a paper-first
  shell with Files / Outline / Read within thumb's reach, opening any `.md`
  from the system document picker or straight from a file manager via
  "Open with", saving back to your device's notes folder, Export as HTML into
  Downloads, system back-button handling that never eats unsaved work, and
  find-and-replace with proper mobile keyboard hints. The app menu carries
  New / Open / Save / Export / Find / Statistics / AI / Settings, Zen mode
  included. This first build is an `arm64-v8a` APK attached to the GitHub
  release — install it by allowing "install unknown apps" for your browser
  once. Modern Android phones only (Android 10+).
- **Zen mode.** Press F9 (or pick it from the command palette) and everything
  but the page melts away: just your document, centered, in the reading
  typography. The canvas is editable in place with Ctrl+E, a top bar appears
  when you hover the screen edge, and the choice is remembered across
  launches.
- **Backlinks panel.** The link icon in the status bar lists every note that
  links to the one you are reading, so following the trail backwards no
  longer means searching by hand.
- **Save conflicts are caught.** If a file changed on disk after you opened
  it — another editor, a sync tool — Paperling now asks before overwriting
  instead of silently clobbering the newer copy, and can keep either side.
- **Unsaved tabs are marked.** A tab holding unsubmitted changes shows a
  bullet next to its name, matching the • in the window title, so a quick
  glance tells you what still needs saving.
- **Optional Vim mode.** Settings → Editor → "Vim mode" turns on modal
  editing in the editor: h/j/k/l movement, the full normal/insert/visual
  set, `:` commands. Everything else stays exactly as it was when it is
  off. (#119)
- **Three new themes and an accent color.** Graphite, Nord and Midnight join
  Dark, Light, Paper and Dracula, and each theme's accent color can be
  tuned in Appearance. (#172)
- **Custom system fonts.** Enter an installed font family in Appearance to use
  it across the interface, Markdown preview and exports, with Inter as a safe
  fallback. (#113)
- **Paperling remembers your window.** Size, position and whether it was
  maximized are restored the next time you launch, instead of always reopening
  at the default 1000x700 in the middle of the screen. Thanks to
  [@andychey](https://github.com/andychey).
- **Familiar shortcuts.** Ctrl+F4 also closes the current tab, and F1 also
  opens the command palette, alongside the existing Ctrl+W and Ctrl+P. Thanks
  to [@skycommand](https://github.com/skycommand).
- **LM Studio preset.** The AI settings now offer LM Studio next to Gemini,
  OpenAI and Ollama: pick it and the local server endpoint fills itself, no
  API key needed. (#115)
- **Chat history depth setting.** Choose how many previous chat turns are sent
  with each AI panel message (Settings → AI, default 8). Lower it to save
  tokens with local models, or set 0 to make every message start fresh. (#111)
- **The AI panel is resizable.** Drag its left edge to make it as wide as you
  need, or focus the edge and use the arrow keys. The width is remembered, and
  the editor reflows beside it as you drag. (#111)
- **Your chats are kept.** Closing the AI panel or starting a new chat no longer
  throws the conversation away. Past chats are listed under the new history
  button in the panel header, survive restarting the app, and can be deleted
  individually. (#111)
- **The AI icon animation can be turned off.** Settings → AI → "Animate the AI
  icon" switches the shimmer on the title-bar AI button off, leaving it as plain
  text. (#111)
- **New ways to install.** Paperling is now packaged as a Nix flake (#117) and
  a portable Windows zip for Scoop (#48), and the macOS download is a single
  universal `.dmg` with honest Gatekeeper instructions (#94, #103).

### Fixed

- **Wide tables no longer wreck the page.** A table wider than the window
  used to push the whole document out sideways; wide tables now scroll
  inside their own box, in the app and in exports.
- **The Gemini preset points at a model that exists.** Google retired
  `gemini-2.5-flash` for new API keys, so the preset's one-click setup
  handed every new user a broken model; it now fills `gemini-3.6-flash`
  (verified against the live API).
- **The PDF print dialog on Linux behaves.** Exporting to PDF opened the
  system print dialog twice, and cancelling left the Export button spinning
  forever; it now opens once and the button frees up immediately.
- **The find bar stays put.** Typing in Find used to bounce focus into the
  document a moment later, so the next keystroke could overwrite your
  matched text; focus now stays in the bar, and one find mechanism serves
  both the editor and reader modes.
- **The outline sheet respects the bottom bar on Android.** Opening the
  table of contents used to cover the Files / Outline / Read bar; the bar
  now stays reachable so you can jump to Read or close the sheet without
  dismissing it first.
- **Hard-to-see text selection.** In the Light and Paper themes, selecting text
  in the editor painted a dark block over dark text, so you could see what was
  selected but not read it; both themes now tint the selection instead. In every
  theme, the highlight on the line you are typing on also washed the selection
  out on that line, which is the one line every selection touches. That
  highlight now steps aside while text is selected. Thanks to
  [@skycommand](https://github.com/skycommand).
- **The About page now shows the version you are running.** Settings, About
  reported only the app name, which made it awkward to file a bug report.
  Thanks to [@skycommand](https://github.com/skycommand).
- **Undo in the AI chat box.** Ctrl+Z now works while typing a message in the
  AI panel; the composer no longer resets the native undo history on Linux.
  (#111)
- **Find now searches AI suggested changes properly.** While reviewing an AI
  edit, Ctrl+F only looked at the proposed text, so words sitting in the removed
  lines were never found: you could see four matches on screen and the bar would
  say two, with next/previous skipping the ones you were looking at. Find now
  covers both sides of the diff and steps through them in the order they appear
  on screen. Replace still only touches the proposed text, since the removed
  lines are the version being replaced. (#111)
- **API keys are no longer sent unencrypted.** If an AI endpoint used plain
  `http://` and pointed at anything other than your own machine, the key went
  over the network in the clear. Paperling now refuses that request and says so
  in Settings, AI. Local servers keep working exactly as before: `http://` is
  still fine for `localhost` and `127.0.0.1`, and a keyless server on your home
  network is still allowed, since there is no key to expose. (#91)

### Security

- **The webview has no filesystem permissions at all.** Exports used to
  carry a blanket write grant into every folder the save dialog could
  reach; all export writes now go through one validated Rust command
  (dialog-chosen path, size-capped, mobile-sandboxed), so a compromised
  renderer cannot read, enumerate, rename or delete files. (#91, #188)
- **The Android app is sandboxed by default.** File commands are confined
  to the app's private storage, the JavaScript bridge only answers the
  app's own origin, AI keys and notes are excluded from cloud backups,
  PDF export staging files are unguessable, and the release content
  security policy allows nothing remote.

## [1.0.49] - 2026-07-12

### Added

- **More markdown syntax.** `==highlight==`, superscript (`x^2^`), subscript
  (`H~2~O`), definition lists (`Term` / `: definition`) and custom heading ids
  (`# Title {#my-id}`) now render in the preview and in every export. Note: a
  single `~tilde~` now means subscript; `~~double~~` is still strikethrough.
- **One-click AI setup.** The AI settings page now has provider presets
  (Google Gemini, OpenAI, Ollama): pick one and the endpoint and model fill
  themselves, so you only paste your API key.
- **"Open files in reader mode" setting.** When on, every file you open starts
  in the comfortable reading view; editing stays one click away. New files
  still open in the editor.
- **Subfolders in the file explorer.** Nested folders now show up and can be
  browsed without leaving Paperling.
- **Windows on ARM.** Releases now include a native arm64 installer.

### Fixed

- **Double print dialog when exporting PDF on Linux.** The system print dialog
  opened twice for one export, and cancelling both left the Export button
  stuck on a spinner. The dialog now opens once and the button frees up as
  soon as the dialog appears.
- **Checkbox clicks jumped the view to the top.** Ticking a task checkbox in
  the preview snapped both panes to the top of the document in split view. The
  toggle now edits only that one line, so your scroll position stays put.
- **Chemistry guidance.** The feature guide now explains that chemistry
  notation renders through the bundled KaTeX `mhchem` extension and needs to
  be wrapped in `$...$` or `$$...$$` like any other math, no LaTeX
  installation needed.
- **Find could edit your document.** Typing in the find bar moved focus into
  the document a moment later, so your next keystroke overwrote the matched
  text. Focus now stays in the find bar, and Enter / Shift+Enter cycle through
  matches from the keyboard.
- **Selected text was unreadable.** The editor painted every selection in a
  fixed pale lavender regardless of theme. Selections now use each theme's own
  colors in all four themes.
- **Custom AI endpoints.** OpenAI-compatible endpoints failed with "Failed to
  fetch" even though they worked in curl. AI requests now go through the app
  itself instead of the browser layer, so any endpoint curl can reach works,
  including plain-http servers on your local network. Wrong keys, timeouts and
  unreachable servers now show clear messages.
- **Word export.** Exporting to .docx failed with an internal error; it now
  produces a proper Word document.
- **Footnote links.** Clicking a footnote reference now scrolls to the note
  and the return arrow scrolls back, in the app and in exported HTML.
- **Local links in exported HTML.** Links to other .md files used to export as
  dead "#" anchors; they now keep their real target.
- **Small Mermaid diagrams.** Diagrams now scale to the reading column so
  their text is legible, in the app and in exports.
- **Phantom unsaved changes on Windows files.** Opening a file with Windows
  (CRLF) line endings immediately marked it as modified. Files open clean, and
  saving preserves the file's original line-ending style.
- **White flash at startup.** The window now appears only after your theme has
  painted, so dark-theme users no longer get a white flare on launch.
- **A friendlier welcome tour.** The first card asks before starting, skipping
  is impossible to miss, the tour covers just the three least discoverable
  features, and its buttons no longer wrap onto two lines.
- **macOS: PDF export.** Exporting to PDF used to spin forever and produce
  nothing; it now saves directly through the system's native PDF path.
- **Linux: launch crash on GNOME/Wayland** (WebKitGTK DMABUF "Error 71
  Protocol error") is fixed.

### Thanks

This release was shaped by the community, and it shows:

- [Andreu Rodríguez Donaire](https://github.com/anrodon) contributed the
  subfolder support in the file explorer.
- [Eli Pinkerton](https://github.com/wallstop) contributed Windows on ARM
  support.
- [techie-monk0](https://github.com/techie-monk0) added supply chain security
  scanning to every build.
- The detailed reviews and bug reports from Reddit users CodenameFlux,
  Individual-Diet-5051, Fantastic_Back3191 and Cast_Iron_Skillet drove most of
  the fixes above. Thank you for taking the time to write them up.

## [1.0.48] - 2026-07-04

### Fixed

- **Tab "unsaved" indicator.** The mark showing a tab has unsaved edits rendered
  as a hollow ring next to the close button, which looked broken and unclear. It
  is now a small filled dot in the same amber as the status bar's "Unsaved"
  indicator, and it cleanly becomes the close (×) button on hover.

## [1.0.47] - 2026-07-04

### Added

- **Interactive feature guide.** The welcome tour now ends with "Open the
  guide", which opens a real, editable document that shows off live math,
  Mermaid diagrams, tables, task lists, code blocks and frontmatter, so you can
  try every feature hands-on. Open it anytime from the command palette with
  "Open the interactive guide".
- **The tour covers more of the app.** Added steps that point out the file
  explorer and the document outline so new users find them right away.

### Fixed

- **Export button icon.** The Export button used a download arrow that read like
  an import action; it now uses a clearer export icon.

## [1.0.46] - 2026-07-02

## [1.0.45] - 2026-06-28

### Added

- **Tabs remember your place.** Switching back to a tab returns you to the line
  you were on instead of jumping to the top.

## [1.0.44] - 2026-06-28

## [1.0.43] - 2026-06-28

### Added

- **Multiple tabs.** Open several files at once. Opening a file (or following a
  link) opens it in a new tab instead of replacing what you're reading. The tab
  bar is always shown once a file is open and has a **+** button to open more.
  `Ctrl+N` opens a new tab, `Ctrl+W` closes one, middle-click closes too, and
  `Alt+←` / `Alt+→` move to the previous/next tab. Unsaved tabs prompt before
  closing.

### Changed

- The title bar's back/forward arrows are gone — tabs (and `Alt+←` / `Alt+→`)
  cover moving between files now.

## [1.0.42] - 2026-06-28

## [1.0.41] - 2026-06-28

### Added

- **Search across files** (`Ctrl+Shift+F`). Search the text of every markdown
  file in the current folder, grouped by file with line numbers; pick a result
  to jump straight to that line. Also in the command palette.
- **`[[` autocomplete.** Typing `[[` in the editor now suggests the other
  markdown files in the folder, so linking is a couple of keystrokes.
- **Create missing notes.** Clicking a `[[link]]` or relative link to a file
  that doesn't exist yet offers to create it and opens the new note.

## [1.0.40] - 2026-06-28

### Added

- **Link navigation with history.** Clicking a `[[wikilink]]` or a standard
  relative `[text](note.md)` link now opens that file in-app. Back and forward
  buttons (and `Alt+←` / `Alt+→`) move through the files you've visited, and
  opening a file now starts you at the top instead of the previous scroll spot.

## [1.0.39] - 2026-06-28

## [1.0.38] - 2026-06-28

### Added

- **Word (.docx) export.** Export → Word writes a real Office Open XML document
  from the current file, with headings, lists, tables, bold/italic, links, and
  images carried over. Like PDF, it's a clean light document for sharing.

## [1.0.37] - 2026-06-28

## [1.0.36] - 2026-06-28

## [1.0.35] - 2026-06-22

### Added

- The Export and Settings dropdown menus are now fully keyboard-operable: focus
  moves into the menu on open, Arrow/Home/End move between items, and Escape
  closes and returns focus to the button.
- The file explorer refreshes when the window regains focus and gained a manual
  refresh button, so its list no longer goes stale after files change on disk.

### Changed

- **PDF export now saves directly.** On Windows, "Export → PDF" asks where to
  save and writes the file straight away, instead of opening the system print
  dialog. The PDF keeps selectable text and working links.
- The theme now matches your operating system's light/dark setting on first
  launch, and follows it until you pick a theme yourself.
- Notifications stack instead of replacing one another, and error messages stay
  on screen longer than confirmations.
- The Light theme has a softer, warmer tone for a bit more character.

### Removed

- The GitHub theme. (Light covers the same clean, bright look.)

### Fixed

- Find & Replace now shows "Invalid pattern" for an unparseable regex instead of
  a misleading "No results".
- Cancelling the export save dialog no longer shows a false "Exported" message.
- A persistent autosave failure keeps reminding you (throttled) instead of
  going quiet after the first warning.

## [1.0.34] - 2026-06-22

## [1.0.33] - 2026-06-18

## [1.0.32] - 2026-06-18

## [1.0.31] - 2026-06-18

## [1.0.30] - 2026-06-18

### Changed

- The "What's new" update popup now shows a concise summary of just the latest
  release's changes, instead of the full changelog history.

## [1.0.29] - 2026-06-18

### Added

- **Fullscreen mode (F11)** for distraction-free writing on Windows, Linux, and
  macOS. The title bar stays visible so there is always an obvious way out, with
  a one-time hint. Also available from the command palette.
- **Automatic updates.** Paperling checks for new versions on launch and offers
  a one-click update when a newer version is available. Update packages are
  signed and verified before installing.
- **Enable AI toggle** (Settings → AI). Turning AI off hides every AI surface:
  the title-bar button, the side panel, the toolbar sparkle, Alt+J, and the
  command palette entry.
- **Visual table editor.** A floating toolbar appears inside a Markdown table to
  insert or delete rows and columns, set per-column alignment, and re-align the
  layout.
- **Chemistry notation in math.** KaTeX now renders `\ce{...}` and `\pu{...}`
  (mhchem), with a `/chem` slash command to insert a starter snippet.
- **Document statistics** dialog — words, characters, sentences, paragraphs,
  headings, links, images, code blocks, and reading time.
- **Word wrap** and **spell check** toggles in Settings → Editor.
- **Selected word count** in the status bar, plus command-palette actions to
  reveal the current file in its folder and copy its path.

### Changed

- **Relicensed to Apache 2.0** — free for personal and commercial use, with an
  explicit patent grant.
- **Works fully offline.** All fonts and the icon set are now bundled, so the
  editor looks identical online and offline, and HTML export no longer depends
  on Google Fonts.
- **Book-style math typography** — display equations are centered with proper
  spacing and scroll horizontally on narrow screens instead of overflowing.

### Fixed

- List bullets and numbers render in the preview again.
- Ctrl+S / Ctrl+O / Ctrl+N / Ctrl+E now work with CapsLock on.
- Clicking a heading's anchor link copies a section link and confirms with a
  checkmark.
- Alt+J reliably opens the AI panel on Windows, where WebView2 had reserved
  Ctrl+J for its Downloads UI.
- The caret no longer drifts off the text after scrolling large documents.
- Clearer file-operation error messages (for example "File too large") instead
  of generic failures.
- Security hardening across file, image, AI, and wikilink handling: size limits,
  filename and path-traversal sanitizing, an AI request timeout and response
  cap, and a tightened Content Security Policy.

### Removed

- Retired dead auto-save / focus-mode storage helpers left over from 0.6.1.

### Performance

- Faster cold start and a much smaller initial bundle — the welcome screen no
  longer loads the markdown, export, or dialog code until it is needed — plus
  smoother typing and scrolling on large documents.

## [0.6.1] - 2026-04-30

### Fixed

- "This file was deleted or moved" banner appearing on every opened file (false positive in mtime polling) — feature removed
- Outline panel: scrolling broken and last item bleeding into status bar (missing `flex flex-col` + `min-h-0` chain on the panel)
- TOC links inside markdown body (e.g. `[Q1](#q1)`) not navigating to their headings — explicit click handler added with fuzzy heading-text fallback for non-matching slugs
- New File button doing nothing visible — `hasFile` now considers a blank `Untitled.md` buffer as "open"
- Command palette on the welcome screen exposing Save / Save As / view toggles that wouldn't work without a buffer

### Removed

- Auto-save toggle (UI removed from Settings dropdown, Settings modal, command palette, status bar)
- Focus-mode dimming of non-active editor lines — all lines now render at full opacity (typewriter mode kept)
- External-change polling that was watching the open file's mtime

### Changed

- Wikilink resolution and recent-file existence checks use the existing `get_file_info` Rust command instead of the fs plugin's `stat`

## [0.6.0] - 2026-04-29

### Added — Editor

- Tab / Shift+Tab indent (multi-line aware)
- Auto-pair for `()`, `[]`, `{}`, `` ` ``, `""`, `''` — wraps selection or inserts pair, type-past closer, atomic backspace
- Enter continues lists, blockquotes, and task items
- Markdown formatting shortcuts: Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+/
- Find & Replace (Ctrl+F / Ctrl+H) with regex, case-sensitive, match counter
- Slash commands `/` with 13 block transformations
- Smart paste: URL → link, plain URL → autolink, rich HTML → markdown (Turndown), TSV → GFM table
- Tab navigation inside markdown tables (skips separator, creates rows)
- Formatting toolbar above editor (toggleable)
- Focus mode (dim non-active lines)
- Typewriter mode (caret stays vertically centered)
- Active-line highlight in editor and gutter

### Added — Preview

- Code blocks have a hover-revealed Copy button
- Headings get GitHub-style stable slug IDs and clickable anchor links
- Click-to-zoom image lightbox
- Lazy image loading
- Interactive task checkboxes — toggling writes back to source
- KaTeX math rendering (`$inline$`, `$$block$$`) — lazy-loaded
- Mermaid diagrams (` ```mermaid `) — lazy-loaded
- YAML frontmatter parsed and rendered as a collapsible, editable Properties card
- Wikilinks `[[Foo]]` and `[[Foo|alias]]` clickable in preview

### Added — App

- Split view (Ctrl+\\) with draggable, keyboard-resizable divider
- Bidirectional scroll sync between editor and preview in split mode
- Restore last opened file on launch
- View mode and split ratio persist across sessions
- Recent files list on welcome screen with parent folder, time-ago, remove button; missing files struck through
- New File (Ctrl+N) and Save As (Ctrl+Shift+S)
- External-change detection — banner offers Reload/Keep mine when the file is modified outside MarkLite
- Auto-save toggle (1.5s debounce) with status chip in StatusBar
- Command palette (Ctrl+P) with fuzzy ranking — searches commands, files, headings, toggles
- Settings modal (Ctrl+,) with sidebar navigation and search
- Keyboard cheatsheet modal (`?`)
- Outline pane highlights the heading the cursor is in; filter input for large docs
- AI assist scaffold (Ctrl+J) — Rewrite / Shorten / Expand / Continue / Translate via configurable OpenAI-compatible endpoint (Ollama, llama.cpp, OpenAI, etc.)
- Reading time and character count in StatusBar

### Fixed

- Caret no longer drifts vertically between the textarea and syntax-highlight overlay (font metric alignment, empty-line rendering, rAF-driven scroll sync)
- Paper theme `--text-muted` darkened to pass WCAG AA contrast
- Sidebar panels (FileExplorer, TableOfContents) now trap focus
- Toast errors announce as `role="alert"` / `aria-live="assertive"`
- `prefers-reduced-motion` is respected globally

### Changed

- Visible focus rings on all interactive elements (keyboard focus only)
- Design tokens for radius and spacing in `:root`
- StatusBar replaces inert "UTF-8" with icons next to word count and reading time
- TitleBar shows a hint when no file is open
- Welcome screen lists New File alongside Open File and surfaces Ctrl+P / `?` hints

### Removed

- The hidden off-screen markdown renderer used for export — capture happens directly from the visible preview now

## [0.5.1] - 2026-01-XX

### Added

- Error boundary
- Unsaved-changes protection on close
- Loading state during file open

## [0.1.0] - 2025-01-01

### Added

- Initial release of MarkLite
- Clean markdown preview with live rendering
- Code editor with syntax highlighting
- Three themes: Dark, Light, and Paper
- Five font options: Inter, Merriweather, Lora, Source Serif, Fira Sans
- Three font sizes: Small, Medium, Large
- Keyboard shortcuts (Ctrl+O, Ctrl+S, Ctrl+E)
- Cross-platform support (Windows, macOS, Linux)
- Custom titlebar with window controls
- Settings menu for theme and font customization
- Drag and drop support for markdown files
- Auto-save indicator in status bar
