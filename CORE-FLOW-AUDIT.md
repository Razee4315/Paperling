# Core-flow audit: what most users actually touch (2026-10-02)

Scope: not another feature audit. This one asks which handful of things a normal user does every time they open Paperling, how well those work for someone who has never read the docs, and what is missing from that path.

Method: a fresh profile (cleared storage) in the browser build at `?fakefs=1`, walked as a first-time user: welcome screen, tour, new note, typing, switching modes, closing with unsaved work, opening existing files, menus, settings. Each finding below was either seen live or read in the code at the line given. Native-only behaviour (installer, file association, real dialogs) was read in code and config, not run.

## TL;DR

| # | Finding | Type | Effort |
|---|---|---|---|
| 1 | **Saving is invisible on desktop.** No Save button or menu item anywhere; autosave is off by default. Only `Ctrl+S` or the command palette saves. | P1 core flow | Small |
| 2 | **After one edit, every file opens as raw Markdown.** The view mode is global and remembered, so the "read it beautifully" promise breaks the first time a user tries Code mode. | P1 core flow | Small |
| 3 | **The title bar's "Edit" button does not edit.** It opens a menu with Find, Replace and Find in Files. The real read/edit switch is an icon pill in the bottom-right corner. | P1 discoverability | Small |
| 4 | **The welcome tour teaches the wrong three things**: Files, Outline, command palette. It never shows how to switch between reading and editing, or how to save. | P1 onboarding | Small |
| 5 | **Editing is raw Markdown with no help.** Formatting toolbar is off by default on desktop; spell check is off by default. A user who does not know Markdown syntax has nothing to click. | P2 core flow | Small |
| 6 | **No zoom.** `Ctrl +` / `Ctrl -` / `Ctrl 0` / `Ctrl+wheel` do nothing; text size is four presets inside a menu. | P2 missing | Small |
| 7 | **Theme ignores the system.** First run is always Paper, even on a dark-mode OS, and there is no "Follow system" option. | P2 missing | Small |
| 8 | **"Edit Reader" strip** takes a permanent row in Reader mode for everyone, with unclear wording, while double-clicking text in Reader does nothing. | P2 polish | Small |
| 9 | **Print is hidden.** `Ctrl+P` opens the command palette; Print exists only as a palette command. | P3 | Small |
| 10 | Only `.md` and `.markdown` are registered with the OS; `.txt` and `.mdx` open in the app but cannot be double-clicked into it. | P3 | Small |
| 11 | The welcome screen and About call the app "A minimal markdown editor"; the README and site sell a reader first. | P3 copy | Tiny |

Everything in the table is cheap. None of it needs a new subsystem; most are a default value, a label, or one button.

## 1. The features most users will ever see

From the product pitch ("open any `.md` file and read it beautifully, edit when you need to") and from walking the app, a typical session is:

1. **Open a file**: double-click in Explorer/Finder, the Open button, a drop, or a recent file.
2. **Read it**: Reader mode, scroll, maybe the outline.
3. **Change something**: switch to an editing view, type.
4. **Save**.
5. **Move between a few files**: tabs, recents.
6. **Find a word** (`Ctrl+F`).
7. **Set the look once**: theme, font, size.
8. **Occasionally export or print**.

That is the whole product for most people. AI, backlinks, wikilinks, Mermaid viewer, Vim mode, Zen, typewriter mode, folder search, the command palette and custom shortcuts are the long tail: valuable for the few who find them, invisible to the rest. The core eight are where polish pays.

State of each today:

| Step | State | Note |
|---|---|---|
| Open | Good | Drop, dialog, recents (pinned, 25), session restore, single instance, Finder/argv handoff. |
| Read | Good | Typography, themes, readable width, code copy, outline, images, math, diagrams. |
| Switch to edit | **Weak** | Findings 2, 3, 4, 8. |
| Type / format | **Weak for non-Markdown users** | Finding 5. Strong for people who know Markdown (smart paste, list continuation, table Tab, bracket closing). |
| Save | **Weak** | Finding 1. The engine underneath is excellent. |
| Tabs | Good | Reorder, context menu, reopen closed, unsaved prompt. |
| Find | Good | In-file, replace, in folder. |
| Appearance | Good, two gaps | Findings 6, 7. |
| Export | Good | HTML, PDF, Word in a visible menu. Print hidden (9). |

## 2. Findings in detail

### 2.1 P1: saving is invisible on desktop

Seen live: the title bar has New, Open, "Edit", Export and Settings. None of them contains Save or Save As. The only signal is a small "Unsaved" dot in the status bar. The phone layout does have Save and Save as in its menu (`src/App.tsx:1997-1998`); the desktop does not.

```ts
// src/utils/persistence.ts:178
export const getAutoSave = (): boolean => safeGet<boolean>(KEY_AUTO_SAVE, false);
```

Why it hurts: a user who does not think in shortcuts types, sees "Unsaved", and has nothing to click. They find out at close time through the Unsaved Changes dialog. People coming from Obsidian, Typora, Notion or Google Docs expect never to think about saving at all.

Fix:
- Turn autosave on by default for files that already have a path. The save path is already atomic, conflict-guarded and backed by hot-exit recovery (EXT/TABS/HOT series), so the risk that usually argues against autosave is already handled. Untitled notes keep the current prompt.
- Make the status-bar "Unsaved" indicator a button that saves.
- Put Save and Save As in a visible menu (see 2.3).

### 2.2 P1: after one edit, files open as raw Markdown

Seen live: open `Welcome.md` (Reader), click Code once, open `Ideas.md`: it opens as raw source with line numbers.

```ts
// src/utils/persistence.ts:142, 185
export const getSavedViewMode = () => safeGet(KEY_VIEW_MODE, "preview");
export const getOpenInReader = (): boolean => safeGet<boolean>(KEY_OPEN_IN_READER, false);
```

Why it hurts: the README's first paragraph says the app exists because opening a `.md` shows "raw, unformatted text with all the symbols". After a single edit, that is exactly what the next double-clicked file shows, and it stays that way across restarts. The setting that fixes it ("Open files in reader mode") exists but is off and three clicks deep.

Fix: default `getOpenInReader` to `true`. Files you open are read first; new notes still start in the editor. Better still, remember the mode per tab so switching one note to Code does not flip the others.

### 2.3 P1: the "Edit" button is a Find menu

Seen live: clicking **Edit** in the title bar (`src/components/EditMenu.tsx:68`) shows Find, Find and Replace, Find in Files. The control that actually switches between reading and editing is the floating pill at the bottom-right (`src/components/ModeToggle.tsx:27-55`), where the two inactive modes are icons with no text.

Why it hurts: "Edit", with a pencil icon, next to a rendered document, reads as "let me edit this". It is the first thing a new user clicks to start typing, and it offers search.

Fix: rename that menu to **Find** with a search icon. Give the title bar a real two-state **Read / Edit** button (or move the mode pill up there), with text labels. A conventional **File** menu (New, Open, Open folder, Save, Save As, Print, Export) would also solve 2.1 and 2.9 in one place.

### 2.4 P1: the tour teaches the long tail

`src/components/Tour.tsx:36-74` has five steps: welcome, file explorer, outline, command palette, done. Seen live.

Why it hurts: the one moment the app has the user's attention is spent on three features most people will not use this week. Nothing shows the Reader / Split / Code switch (`Ctrl+E`), and nothing says how saving works.

Fix: replace the middle steps with (1) "Read or edit": point at the mode switch, mention `Ctrl+E`; (2) "Your work is saved": once autosave is on; (3) "Make it yours": theme and text size. Keep Files / Outline / palette for the interactive guide, which already exists.

### 2.5 P2: editing gives no help to people who do not know Markdown

```ts
// src/utils/persistence.ts:164, 168
export const getToolbarEnabled = (): boolean => safeGet<boolean>(KEY_TOOLBAR, IS_MOBILE);
export const getSpellCheck = (): boolean => safeGet<boolean>(KEY_SPELL_CHECK, false);
```

Seen live: a new note opens in Code mode as an empty monospace page with a line number. No buttons for bold, heading, list, link, image or table. The toolbar exists and is good; it is on by default only on phones.

Why it hurts: this is the "editor" half of the pitch. Typora and MarkText users never see syntax; Obsidian users get Live Preview. Here the default is the experience of Notepad with colours.

Fix, in order of cost:
1. Turn the formatting toolbar on by default on desktop, and spell check on by default.
2. Make **Reader editing** (#213, now covering wikilinks and task lists) the thing "Edit" leads to for ordinary notes, with Code one click away. This is the real answer to "edit without seeing symbols".
3. Longer term: Live Preview in the Code editor (hide syntax on lines the caret is not on). Largest single feature gap against Obsidian and Typora.

### 2.6 P2: no zoom

`src/config/keybindings.ts` has no zoom binding, and nothing handles `Ctrl+wheel`. Text size is Small / Medium / Large / XL in the settings menu (`src/components/SettingsModal.tsx:88-91`).

Why it hurts: zoom is reflex in every reader and browser. It is also an accessibility need.

Fix: bind `Ctrl +`, `Ctrl -`, `Ctrl 0` and `Ctrl+wheel` to step the existing font-size setting (or a finer scale), and show the level briefly.

### 2.7 P2: theme ignores the system

```ts
// src/context/ThemeContext.tsx:70-77
function getInitialTheme(): Theme { /* stored choice */ return 'paper'; }
```

No `prefers-color-scheme` check exists anywhere in `src`. Why it hurts: a user on a dark desktop opens a bright cream window at night, and there is no "match my system" choice among the seven themes.

Fix: on first run pick Paper or Graphite/Dark from the OS setting; add a "Follow system" option with a light and a dark theme of choice.

### 2.8 P2: the "Edit Reader" strip

`src/components/MarkdownPreview.tsx:1497-1503`: Reader mode always shows a toolbar row whose only content is a small text button, "Edit Reader". With it off, double-clicking rendered text does nothing (`:1549` returns early when editing is disabled).

Why it hurts: it costs a row of the most-seen view, the label is not a phrase a user would recognise, and the natural gesture (double-click the sentence you want to fix) is dead.

Fix: drop the strip when Reader editing is off. Make double-click in Reader start editing that block (or jump to that line in Code). Rename to "Edit here" / "Done".

### 2.9 P3: smaller items

- **Print**: only `file.print` in the palette (`src/App.tsx:1581`). Add "Print…" to the Export menu.
- **File types**: `src-tauri/tauri.conf.json:65-76` registers `md` and `markdown`. Add `mdx`, `mdown`, `mkd`; offer `.txt` as a secondary "Open with".
- **Copy**: `src/components/WelcomeScreen.tsx:199` and `SettingsModal.tsx:754` say "A minimal markdown editor". Use the reader-first line from the README.
- **No right-click menu in the editor or the Reader**: custom menus exist only for tabs and files (`TabBar.tsx:192`, `FileExplorer.tsx:401`). A short one (Cut, Copy, Paste, Bold, Italic, Link; in Reader: Copy, Edit here) is what mouse users reach for.
- **Dev console warning**: the image placeholder renders a `<div>` inside a `<p>` (seen in the console while testing images). Harmless, worth tidying.

## 3. What is already good (do not rework)

- **Data safety under the save path**: atomic writes, external-change conflict dialog that never auto-resolves, hot-exit recovery, per-tab undo. This is why autosave-by-default is safe to switch on.
- **Opening files**: drop, recents with pins, session restore, single instance, Finder handoff.
- **Reader rendering**: typography, math, diagrams, callouts, code copy, sanitize pipeline.
- **Close-with-unsaved prompt**: clear, three choices, sensible default.
- **Save-name suggestion** from the first heading for untitled notes.
- **Markdown power-user editing**: smart paste, table Tab, list continuation, select next occurrence.
- **Tabs** and their context menu.

## 4. Missing features that should exist, ranked

1. **Autosave on by default** and a visible Save (2.1).
2. **Reader-first opening** by default (2.2).
3. **A real Read / Edit control** in the title bar (2.3).
4. **Formatting toolbar and spell check on by default** (2.5).
5. **Zoom** (2.6).
6. **Follow system theme** (2.7).
7. **Editing without symbols as the default edit experience**: Reader editing promoted, then Live Preview (2.5).
8. **Right-click menu** in editor and Reader (2.9).
9. **Print in a visible menu** (2.9).
10. **Tables and images editable in Reader**: the two remaining blocks people most want to touch without seeing pipes and brackets.

## 5. Suggested order of attack

**Batch A, one PR, defaults and labels only (about a day):**
autosave default on for saved files · open-in-reader default on · toolbar and spell check default on · rename "Edit" to "Find" · remove the idle "Edit Reader" strip · welcome/About tagline · Print in Export menu. Existing users keep their stored settings; only fresh installs change.

**Batch B (one to two days):**
title-bar Read / Edit button with labels · File menu with Save / Save As · clickable "Unsaved" · zoom shortcuts · follow-system theme · new tour steps.

**Batch C (larger):**
double-click-to-edit in Reader · right-click menus · per-tab view mode · extra file associations.

**Later:** Live Preview in the editor; table and image editing in Reader.
