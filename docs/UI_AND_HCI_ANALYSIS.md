# Paperling: Frontend UI & HCI (Human-Computer Interaction) Analysis

> Comprehensive analysis of UI design issues, accessibility gaps, interaction design flaws, and HCI improvements.

---

## Table of Contents

1. [Accessibility (A11y) Issues](#1-accessibility-a11y-issues)
2. [Interaction Design Flaws](#2-interaction-design-flaws)
3. [Visual Design & UI Consistency](#3-visual-design--ui-consistency)
4. [Information Architecture](#4-information-architecture)
5. [Feedback & System Status](#5-feedback--system-status)
6. [Error Handling & Recovery](#6-error-handling--recovery)
7. [Responsive Design & Layout](#7-responsive-design--layout)
8. [Cognitive Load & Usability](#8-cognitive-load--usability)
9. [Nielsen's Heuristics Evaluation](#9-nielsens-heuristics-evaluation)
10. [Fitts's Law & Motor Interaction](#10-fittss-law--motor-interaction)

---

## 1. Accessibility (A11y) Issues

### 1.1 No ARIA Labels on Interactive Elements

**Affected Components:** StatusBar, FileExplorer, TableOfContents, ModeToggle, CodeEditor
**Severity:** HIGH

Most interactive buttons lack `aria-label` attributes. The StatusBar toggle buttons (lines 28-53) only have `title` attributes. Screen readers cannot properly announce these controls.

**Specific Issues:**
- StatusBar file explorer button: No `aria-label`, icon-only button
- StatusBar TOC button: No `aria-label`, icon-only button
- ModeToggle buttons: No `aria-label` distinguishing Reader vs Code
- SettingsMenu button: No `aria-label`
- Export dropdown items: No `aria-label`

**Fix:** Add descriptive `aria-label` to every icon-only button:
```tsx
<button aria-label="Toggle file explorer" ...>
```

### 1.2 No Keyboard Navigation for Sidebars

**Affected Components:** FileExplorer, TableOfContents
**Severity:** HIGH

The sidebar panels have no keyboard trap management. When opened:
- Focus doesn't move to the panel
- Tab key can navigate behind the panel to obscured content
- No Escape key to close (only mouse click on close button)
- No focus restoration when panel closes

**Fix:** Implement focus trap, auto-focus on open, Escape to close, and restore focus on close.

### 1.3 No Skip Navigation Link

**Severity:** MEDIUM

There's no "skip to content" link for keyboard users to bypass the title bar and jump to the main content area.

### 1.4 Color Contrast Issues in Paper Theme

**Severity:** MEDIUM

Paper theme uses `--text-muted: #9a8f7a` on `--bg-primary: #f5f0e6`. The contrast ratio is approximately 2.7:1, which fails WCAG AA minimum of 4.5:1 for normal text. Status bar text and hints will be unreadable for low-vision users.

### 1.5 No `role` Attributes on Custom Components

**Severity:** MEDIUM

- The sidebar panels (`<aside>`) should have `role="complementary"` or `role="navigation"`
- The settings dropdown should have `role="menu"` and items should have `role="menuitem"`
- The export dropdown should follow the same ARIA menu pattern
- The UnsavedChangesDialog should have `role="alertdialog"`

### 1.6 Dialog Doesn't Trap Focus

**File:** `src/components/UnsavedChangesDialog.tsx`
**Severity:** HIGH

The unsaved changes dialog renders as a custom div overlay. It has no:
- `role="dialog"` or `role="alertdialog"`
- `aria-modal="true"`
- Focus trap (tab can still navigate behind the dialog)
- Auto-focus on the primary action button
- `aria-labelledby` / `aria-describedby`

### 1.7 Toast Notification Not Announced to Screen Readers

**File:** `src/components/Toast.tsx`
**Severity:** MEDIUM

The toast notification lacks `role="status"` or `aria-live="polite"`. Screen readers won't announce the message.

**Fix:** Add `role="status"` and `aria-live="polite"` to the toast container.

---

## 2. Interaction Design Flaws

### 2.1 No Undo/Redo Support

**Severity:** HIGH

The CodeEditor uses a plain `<textarea>` with controlled React state. The native browser undo/redo (Ctrl+Z / Ctrl+Y) works partially but can behave erratically because React's controlled component model replaces the textarea value on every keystroke, breaking the browser's undo stack.

**Fix:** Implement a proper undo/redo history stack or use `useRef` for an uncontrolled textarea and sync to state on blur/save.

### 2.2 No Confirmation Before Opening New File with Unsaved Changes

**Severity:** HIGH

The `handleOpenFile` function (App.tsx line 113) and file drop handler open files without checking `isDirty`. Unsaved changes are silently discarded. The unsaved changes dialog only appears on window close.

**Fix:** Check `isDirty` before `loadFile()` and show the UnsavedChangesDialog.

### 2.3 Mode Toggle Only Works on Active Mode Button

**File:** `src/components/ModeToggle.tsx` (lines 12, 24)
**Severity:** MEDIUM

The inactive mode button triggers `onToggle`, but the active mode button has `onClick` set to `undefined`. Users clicking the active button (expecting feedback or re-confirmation) get no response. This violates the principle of least surprise.

**Fix:** Either make both buttons always clickable (with the active one being a no-op with visual feedback) or communicate clearly that it's already selected.

### 2.4 No Drag Handle Feedback

**Severity:** MEDIUM

The title bar serves as a drag region for moving the window, but there's no visual indicator that dragging is possible. Users unfamiliar with custom title bars may not know they can drag to move the window.

### 2.5 Settings Menu Has No Close Indicator

**File:** `src/components/SettingsMenu.tsx`
**Severity:** LOW

The settings dropdown has no explicit close button — it closes on click outside. Users may not discover this pattern, especially on touch devices (if ever ported to mobile/tablet).

### 2.6 File Explorer Closes on File Selection

**File:** `src/components/FileExplorer.tsx` (line 60)
**Severity:** LOW

Selecting a file immediately closes the explorer. Users browsing multiple files have to re-open the panel each time. This adds friction for comparison workflows.

---

## 3. Visual Design & UI Consistency

### 3.1 Inconsistent Border Radius

**Severity:** LOW

Components use different border radius values:
- Settings dropdown: `rounded-xl` (12px)
- Export dropdown: `rounded-lg` (8px)
- Status bar buttons: `rounded` (4px)
- ModeToggle: `rounded-full` (9999px)
- Unsaved dialog: `rounded-xl` (12px)
- Toast: `rounded-lg` (8px)

**Fix:** Establish a design system with 2-3 standard radius values and apply consistently.

### 3.2 GitHub Theme Preview Colors Don't Match Actual Theme

**File:** `src/components/SettingsMenu.tsx` (line 8)
**Severity:** LOW

The GitHub theme preview shows `colors: ['#0d1117', '#161b22']` (dark colors), but the actual GitHub theme in CSS uses `--bg-primary: #ffffff` (white background). The theme preview is misleading.

**Fix:** Update the preview colors to `['#ffffff', '#f6f8fa']` to match the actual GitHub light theme.

### 3.3 ModeToggle Overlaps Content in Small Viewports

**File:** `src/components/ModeToggle.tsx` (line 8)
**Severity:** MEDIUM

The mode toggle is `fixed bottom-8 right-8`, which can overlap with content on narrow viewports, especially when the status bar text extends to the right. There's no responsive adjustment.

### 3.4 No Visual Distinction Between Saved and New File States

**Severity:** LOW

After creating new content (without a file path), there's no clear visual indicator that the content hasn't been saved to disk yet. The "Unsaved" status bar indicator only shows the dirty state relative to the last save, not whether the file exists on disk.

### 3.5 Theme Switcher Color Preview Is Too Small

**File:** `src/components/SettingsMenu.tsx` (lines 76-90)
**Severity:** LOW

The 10x10px theme preview squares are too small to meaningfully convey the theme's appearance. The split-color design for non-GitHub themes isn't immediately intuitive.

---

## 4. Information Architecture

### 4.1 WelcomeScreen Provides Minimal Guidance

**File:** `src/components/WelcomeScreen.tsx`
**Severity:** MEDIUM

The welcome screen only shows "A minimal markdown editor" and an Open File button. New users get no information about:
- Supported features (preview, export, themes)
- Keyboard shortcuts
- Recent files
- File drag-drop capability (only mentioned in tiny hint text)

**Fix:** Add a subtle feature overview or keyboard shortcut hints.

### 4.2 No Recent Files List

**Severity:** MEDIUM

There's no history of recently opened files. Users must navigate to the file each time. For a desktop editor, this is a significant usability gap.

### 4.3 Keyboard Shortcuts Are Undiscoverable

**Severity:** MEDIUM

Shortcuts are only listed in:
- Title attribute on buttons (hover tooltip)
- A tiny floating hint on the ModeToggle (opacity 0 by default)

There's no shortcuts panel, help dialog, or settings page listing all shortcuts.

**Fix:** Add a Help/Shortcuts dialog accessible via `Ctrl+?` or from the settings menu.

### 4.4 No Breadcrumb Navigation

**Severity:** LOW

The title bar shows only the immediate parent folder and filename. For deeply nested files, users lose context about where the file is located.

---

## 5. Feedback & System Status

### 5.1 No Loading State When Opening Large Files

**Severity:** MEDIUM

The `loadFile` function (App.tsx line 69) has no loading indicator. Opening a large markdown file will appear to freeze the UI until the IPC call completes.

**Fix:** Add a loading spinner or skeleton state during file load.

### 5.2 Silent Failure on File Operations

**File:** `src/App.tsx` (lines 78-80, 129, 153, 161)
**Severity:** HIGH

All file operations (`loadFile`, `handleOpenFile`, `handleSaveFile`) catch errors and only `console.error` them. Users get no feedback when:
- A file fails to open (permissions, corrupted file)
- A file fails to save (disk full, permissions)
- A drag-dropped file can't be read

**Fix:** Show toast notifications for all file operation failures with descriptive messages.

### 5.3 No Save Confirmation Feedback

**Severity:** MEDIUM

After pressing Ctrl+S, the only feedback is the status dot changing from orange to green and "Unsaved" to "Saved". This is subtle and easy to miss. There's no toast or brief flash confirmation.

**Fix:** Show a brief "File saved" toast notification on successful save.

### 5.4 Export Success/Failure Not Communicated

**File:** `src/components/ExportMenu.tsx` (lines 34-50)
**Severity:** MEDIUM

The export button shows a spinner during export, but after completion:
- Success: No confirmation message
- Failure: Only `console.error`

The user has to check their file system to verify the export worked.

### 5.5 Status Bar Word Count Not Labeled

**File:** `src/components/StatusBar.tsx` (line 72)
**Severity:** LOW

The word count shows just a number and "words" with no icon, making it blend with other status info. In a quick glance, it's hard to distinguish from the line/column display.

---

## 6. Error Handling & Recovery

### 6.1 `alert()` Used for Error Messages

**File:** `src/components/CodeEditor.tsx` (lines 36, 69)
**Severity:** MEDIUM

Native `alert()` dialogs are used for image paste errors. These:
- Block the UI thread
- Look out of place in a themed app
- Cannot be styled or dismissed by keyboard (on some platforms)
- Don't match the design language

**Fix:** Replace with the existing Toast component or a themed error dialog.

### 6.2 No Auto-Save or Recovery

**Severity:** MEDIUM

If the app crashes or the user accidentally closes (bypassing the dialog), all unsaved changes are lost. There's no:
- Auto-save to a temporary location
- Recovery mechanism on next launch
- Periodic backup

### 6.3 No Error Boundary

**Severity:** MEDIUM

There's no React error boundary wrapping the application. If a component crashes (e.g., markdown parsing error), the entire app goes blank with no recovery option.

**Fix:** Add an error boundary component that shows a friendly error message and allows the user to recover.

---

## 7. Responsive Design & Layout

### 7.1 Fixed Sidebar Width

**File:** `src/components/FileExplorer.tsx` (line 73), `src/components/TableOfContents.tsx` (line 105)
**Severity:** LOW

Both sidebars are fixed at `w-72` (288px). On minimum window size (600px), this takes 48% of the viewport width, leaving very little room for content.

**Fix:** Use responsive width or make the sidebar resizable.

### 7.2 No Responsive Font Size Adjustments

**Severity:** LOW

Font sizes are fixed based on the user's setting (S/M/L). There's no viewport-relative sizing for very large or very small window sizes.

### 7.3 Status Bar Truncation

**File:** `src/components/StatusBar.tsx`
**Severity:** LOW

The status bar doesn't handle overflow. With the file explorer button, TOC button, save status, line/col, word count, and UTF-8 indicator, the bar could overflow on narrow windows.

---

## 8. Cognitive Load & Usability

### 8.1 Two Different Drag-Drop Implementations

**Severity:** LOW

Drag-drop is handled by:
1. Tauri's native `DRAG_DROP` event (App.tsx line 86) — for when a file is loaded
2. React's `onDragOver`/`onDrop` (WelcomeScreen.tsx lines 7-25) — for the welcome screen

The WelcomeScreen handler uses `file.path` which is a Tauri-specific extension, while the Tauri event listener is more reliable. This duplication can cause confusion and inconsistent behavior.

### 8.2 Settings Changes Apply Immediately with No Preview

**Severity:** LOW

Changing theme, font, or font size in the settings menu applies instantly. Users can't preview a setting before committing. While the changes are easily reversible, rapid switching can be disorienting.

### 8.3 Export Menu Doesn't Explain Differences

**File:** `src/components/ExportMenu.tsx`
**Severity:** LOW

The export dropdown shows "HTML" and "PDF" with icons but no description of what each format offers (e.g., "Styled standalone webpage" vs "Print-ready document"). Users must guess which format suits their needs.

### 8.4 No Markdown Cheatsheet/Help

**Severity:** MEDIUM

For users less familiar with markdown syntax, there's no built-in reference or cheatsheet. Adding a small help panel or tooltip system would reduce cognitive load.

---

## 9. Nielsen's Heuristics Evaluation

### H1: Visibility of System Status

| Item | Rating | Issue |
|------|--------|-------|
| Save status | Good | Green/orange dot with text |
| File loading | Poor | No loading indicator |
| Export progress | OK | Spinner shown, no completion feedback |
| Error states | Poor | Errors logged to console only |

### H2: Match Between System and Real World

| Item | Rating | Issue |
|------|--------|-------|
| Terminology | Good | "Reader" / "Code" are clear |
| Icons | Good | Material Symbols are recognizable |
| File metaphors | OK | Folder icon for explorer is standard |

### H3: User Control and Freedom

| Item | Rating | Issue |
|------|--------|-------|
| Undo/Redo | Poor | Unreliable due to controlled textarea |
| Close without saving | Good | UnsavedChangesDialog with 3 options |
| Open new file | Poor | No unsaved check before loading |
| Cancel export | Poor | No way to cancel once started |

### H4: Consistency and Standards

| Item | Rating | Issue |
|------|--------|-------|
| Button styles | OK | Mostly consistent, some radius variation |
| Keyboard shortcuts | Good | Standard Ctrl+O/S/E patterns |
| Color usage | Good | Consistent theme variables |

### H5: Error Prevention

| Item | Rating | Issue |
|------|--------|-------|
| Unsaved changes on close | Good | Dialog shown |
| Unsaved changes on open | Poor | No check |
| Image paste without file | OK | Alert shown but uses native dialog |

### H6: Recognition Rather Than Recall

| Item | Rating | Issue |
|------|--------|-------|
| Shortcuts visibility | Poor | Hidden in tooltips |
| Feature discoverability | Poor | No onboarding or help |
| Current state indication | OK | Mode toggle shows active state |

### H7: Flexibility and Efficiency of Use

| Item | Rating | Issue |
|------|--------|-------|
| Keyboard shortcuts | Good | All major actions covered |
| Theme customization | Good | 4 themes, 5 fonts, 3 sizes |
| No custom shortcuts | Poor | Cannot rebind keys |

### H8: Aesthetic and Minimalist Design

| Item | Rating | Issue |
|------|--------|-------|
| Overall design | Excellent | Clean, focused interface |
| Information density | Good | Minimal but sufficient |
| Visual noise | Good | Well-controlled |

### H9: Help Users Recognize, Diagnose, and Recover from Errors

| Item | Rating | Issue |
|------|--------|-------|
| File errors | Poor | No user-facing messages |
| Export errors | Poor | Console-only logging |
| Paste errors | OK | Alert shown |

### H10: Help and Documentation

| Item | Rating | Issue |
|------|--------|-------|
| Built-in help | Poor | None |
| Tooltips | OK | Present on some buttons |
| Onboarding | Poor | Welcome screen is minimal |

---

## 10. Fitts's Law & Motor Interaction

### 10.1 Window Control Buttons Are Small

**File:** `src/components/TitleBar.tsx` (lines 132-152)
**Severity:** LOW

The minimize/maximize/close buttons are `w-8 h-8` (32x32px). On high-DPI displays or for users with motor impairments, these are at the minimum comfortable target size. The close button especially should be larger due to its destructive nature (WCAG recommends 44x44px minimum for touch targets).

### 10.2 Status Bar Toggle Buttons Are Tiny

**File:** `src/components/StatusBar.tsx` (lines 28-53)
**Severity:** MEDIUM

The file explorer and TOC toggles are `w-6 h-5` (24x20px). This is well below the recommended 44x44px touch target and even below comfortable mouse target size. Users must be very precise to click these.

**Fix:** Increase to at least `w-8 h-7` with appropriate padding.

### 10.3 ModeToggle Position Hides Behind Scrollbar

**Severity:** LOW

The mode toggle is `fixed bottom-8 right-8`. On Windows, the scrollbar takes ~10-17px. The toggle's right edge is 32px from the viewport edge, and with the scrollbar, the gap shrinks to 15-22px. The click target could overlap or be uncomfortably close to the scrollbar.

### 10.4 Export Menu Dropdown Misaligned

**File:** `src/components/ExportMenu.tsx` (line 81)
**Severity:** LOW

The dropdown appears `left-0 top-full`, anchored to the export button. But the export button is in the title bar near the left, meaning the dropdown appears in a good position. However, the dropdown has no pointer/caret indicating its relationship to the trigger button.

---

## Summary of Priority Fixes

### P0 (Must Fix)
1. Add ARIA labels to all interactive elements
2. Implement focus trap in dialogs and sidebars
3. Add error feedback for file operations (replace console.error with toasts)
4. Check unsaved changes before opening new file
5. Fix dialog accessibility (role, aria-modal, focus management)

### P1 (Should Fix)
6. Add toast for save confirmation and export completion
7. Add keyboard shortcut help dialog
8. Replace `alert()` with themed dialog/toast
9. Add loading indicator for file operations
10. Fix color contrast in Paper theme
11. Improve WelcomeScreen with feature hints

### P2 (Nice to Have)
12. Add recent files list
13. Add markdown cheatsheet
14. Increase status bar button hit targets
15. Add error boundary
16. Fix GitHub theme preview colors
17. Standardize border radius across components
18. Add auto-save/recovery mechanism
