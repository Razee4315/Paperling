# Paperling: Optimization, Rendering & Logical Issues

> Deep analysis of performance bottlenecks, rendering problems, and logical issues found in the Paperling codebase.

---

## Table of Contents

1. [Critical Performance Issues](#1-critical-performance-issues)
2. [Rendering Issues](#2-rendering-issues)
3. [Memory Leaks & Resource Management](#3-memory-leaks--resource-management)
4. [State Management Anti-Patterns](#4-state-management-anti-patterns)
5. [Logical Bugs](#5-logical-bugs)
6. [Code Architecture Issues](#6-code-architecture-issues)
7. [Export System Issues](#7-export-system-issues)

---

## 1. Critical Performance Issues

### 1.1 CodeEditor Re-renders Entire Syntax Highlight Layer on Every Keystroke

**File:** `src/components/CodeEditor.tsx` (lines 126-306)
**Severity:** HIGH

The `highlightLine()` function is called for **every single line** on **every keystroke**. For a 1000-line markdown file, this means 1000 function calls creating React nodes on every character typed. The `lines.map()` in the JSX (line 302) rebuilds the entire highlight overlay each render.

**Root Cause:** No memoization of the highlighted lines. The `highlightLine`, `highlightLinks`, `highlightBold`, and `highlightImages` functions are recreated on every render since they're defined inside the component body without `useCallback` or `useMemo`.

**Fix:**
- Memoize the highlighted output using `useMemo` keyed on `content`
- Use virtualized rendering for large files (only render visible lines)
- Debounce the highlight re-computation

### 1.2 Markdown Preview Re-parses on Every Content Change

**File:** `src/App.tsx` (lines 280-292, 306-314)
**Severity:** HIGH

Two separate `<Markdown>` components render the same content:
1. The visible preview in `MarkdownPreview.tsx`
2. A hidden off-screen renderer for export HTML capture (line 311)

Both re-parse markdown on every `content` change. The export renderer uses a 100ms `setTimeout` to capture innerHTML, creating unnecessary re-renders and DOM thrashing.

**Fix:**
- Remove the hidden export renderer; capture HTML from the visible preview when export is triggered
- If dual rendering is needed, debounce the export capture significantly (500ms+)

### 1.3 Word Count Recalculated on Every Render

**File:** `src/App.tsx` (line 66)
**Severity:** MEDIUM

`getWordCount(content)` is called as derived state on every render of `AppContent`, not just when `content` changes. Since `AppContent` re-renders for cursor changes, mode toggles, sidebar toggles, toast visibility, etc., this string splitting runs unnecessarily.

**Fix:** Wrap in `useMemo`:
```tsx
const wordCount = useMemo(() => getWordCount(content), [content]);
```

### 1.4 Line Count Recalculated on Every Render

**File:** `src/App.tsx` (line 64)
**Severity:** MEDIUM

`content.split("\n").length` runs on every render. Same issue as word count.

**Fix:** Wrap in `useMemo`:
```tsx
const lineCount = useMemo(() => content.split("\n").length, [content]);
```

### 1.5 Image Base64 Conversion on Every Render via `btoa(String.fromCharCode(...))`

**File:** `src/components/MarkdownPreview.tsx` (line 51)
**Severity:** HIGH

The `LocalImage` component converts binary data to base64 using `btoa(String.fromCharCode(...data))`. For large images, this spread operation (`...data`) creates an argument list from a potentially huge `Uint8Array`, which can hit the JS engine's maximum call stack size and is extremely slow.

**Fix:**
- Use a chunked base64 encoding approach
- Cache converted images to avoid re-conversion on re-renders
- Use `URL.createObjectURL(new Blob([data]))` instead of base64 for better performance

### 1.6 No Debouncing on Content Changes

**File:** `src/App.tsx` (line 223)
**Severity:** MEDIUM

`handleContentChange` directly calls `setContent(newContent)` on every keystroke. This triggers:
- `isDirty` recalculation
- `lineCount` recalculation
- `wordCount` recalculation
- Export HTML update (with 100ms timeout)
- Re-render of entire component tree

**Fix:** Debounce the derived state updates (not the content itself, for responsiveness) or use `useDeferredValue` for non-critical computed values.

---

## 2. Rendering Issues

### 2.1 Conditional Rendering Causes Component Unmount/Remount

**File:** `src/App.tsx` (lines 319-342)
**Severity:** MEDIUM

The ternary `mode === "preview" ? <MarkdownPreview> : <CodeEditor>` completely unmounts one component and mounts the other when toggling modes. This means:
- Editor state (scroll position, selection) is lost
- Preview scroll position is lost
- All `useEffect` hooks re-run

Despite having `key="preview"` and `key="code"`, these keys actually *enforce* remounting rather than helping.

**Fix:** Render both components and use CSS visibility/display to toggle, preserving state:
```tsx
<div style={{ display: mode === "preview" ? "flex" : "none" }}>
  <MarkdownPreview ... />
</div>
<div style={{ display: mode === "code" ? "flex" : "none" }}>
  <CodeEditor ... />
</div>
```

### 2.2 Scroll Sync Between Textarea, Gutter, and Highlight is Janky

**File:** `src/components/CodeEditor.tsx` (lines 110-123)
**Severity:** MEDIUM

The scroll sync uses imperative DOM manipulation (`gutterRef.current.scrollTop = scrollTop`). This runs on the main thread during the scroll event, causing jank on large files because:
- Scroll events fire at 60fps
- Setting `scrollTop` causes layout recalculation (forced reflow)

**Fix:** Use CSS `overflow: hidden` on the gutter and highlight layers, and sync them via a shared scrollable container or CSS `position: sticky` for the gutter.

### 2.3 FileExplorer and TOC Sidebars Always Mounted

**File:** `src/App.tsx` (lines 347-357)
**Severity:** LOW

Both `FileExplorer` and `TableOfContents` are always rendered in the DOM even when closed (using CSS transform to slide off-screen). This means:
- `FileExplorer` calls `list_directory_files` IPC on mount even when hidden
- Event listeners are attached even when panel is invisible

This is actually a minor positive for animation smoothness but wastes IPC calls.

**Fix:** The `useEffect` in `FileExplorer.tsx` (line 34) already checks `isOpen` before fetching, so the IPC call is guarded. But the components could use lazy mounting for initial render.

### 2.4 CSS Transition on Every Theme Color Change

**File:** `src/index.css` (line 271), `src/App.tsx` (line 295)
**Severity:** LOW

`transition: background-color 0.2s ease, color 0.2s ease` on `body` and `transition-colors` utility class on many components means theme switching triggers hundreds of simultaneous CSS transitions. This can cause dropped frames.

**Fix:** Use a single CSS transition on `html` element and let inheritance handle child elements, or disable transitions during theme switch and re-enable after.

---

## 3. Memory Leaks & Resource Management

### 3.1 Event Listener Cleanup Race Condition

**File:** `src/App.tsx` (lines 84-110, 167-189)
**Severity:** HIGH

The pattern used for setting up Tauri event listeners has a race condition:

```tsx
let unlisten: (() => void) | undefined;
setupDragDrop().then((fn) => { unlisten = fn; });
return () => { if (unlisten) unlisten(); };
```

If the component unmounts before the `listen()` promise resolves, `unlisten` is never set, and the listener is never cleaned up. This is a memory leak.

**Fix:** Use an `AbortController` pattern or track a `mounted` flag:
```tsx
useEffect(() => {
  let mounted = true;
  let unlisten: (() => void) | undefined;

  listen(...).then((fn) => {
    if (mounted) unlisten = fn;
    else fn(); // cleanup immediately
  });

  return () => {
    mounted = false;
    unlisten?.();
  };
}, []);
```

### 3.2 LocalImage Never Revokes Object URLs

**File:** `src/components/MarkdownPreview.tsx` (lines 22-66)
**Severity:** MEDIUM

If switched to `URL.createObjectURL`, the URLs must be revoked. Currently using base64 data URLs which don't need revocation but are memory-heavy. Either way, there's no cleanup when the `imageSrc` state changes or the component unmounts.

### 3.3 Toast Timer Not Properly Cleaned

**File:** `src/components/Toast.tsx` (lines 13-21)
**Severity:** LOW

The inner `setTimeout(onHide, 200)` at line 18 is not cleaned up if the component unmounts during the fade-out period. The `onHide` could be called on an unmounted component.

**Fix:** Track both timers and clear them in the cleanup:
```tsx
useEffect(() => {
  if (isVisible) {
    setIsAnimating(true);
    const fadeTimer = setTimeout(() => {
      setIsAnimating(false);
    }, duration);
    const hideTimer = setTimeout(onHide, duration + 200);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }
}, [isVisible, duration, onHide]);
```

---

## 4. State Management Anti-Patterns

### 4.1 Massive AppContent Component (God Component)

**File:** `src/App.tsx`
**Severity:** MEDIUM

`AppContent` holds 12+ pieces of state and 10+ callbacks. Any state change re-renders the entire component tree. Derived state (`isDirty`, `lineCount`, `wordCount`, `hasFile`) is recalculated on every render.

**Fix:**
- Extract file state into a custom hook: `useFileManager()`
- Extract UI state into a custom hook: `useUIState()`
- Use `useMemo` for all derived state
- Consider `useReducer` for related state transitions

### 4.2 ThemeContext Causes Three Separate Effects

**File:** `src/context/ThemeContext.tsx` (lines 54-66)
**Severity:** LOW

Three separate `useEffect` hooks update `document.documentElement` attributes. These could be a single effect.

**Fix:**
```tsx
useEffect(() => {
  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.setAttribute('data-font', font);
  el.setAttribute('data-font-size', fontSize);
}, [theme, font, fontSize]);
```

### 4.3 No Input Validation on localStorage Reads

**File:** `src/context/ThemeContext.tsx` (lines 23-36)
**Severity:** MEDIUM

The theme context reads from localStorage and blindly casts:
```tsx
const stored = localStorage.getItem(THEME_STORAGE_KEY);
return (stored as Theme) || 'dark';
```

If localStorage contains an invalid value (corrupted, old version), this could lead to undefined behavior — CSS variables won't match any theme selector.

**Fix:** Validate against known values:
```tsx
const validThemes: Theme[] = ['dark', 'light', 'paper', 'github'];
const stored = localStorage.getItem(THEME_STORAGE_KEY);
return validThemes.includes(stored as Theme) ? (stored as Theme) : 'dark';
```

---

## 5. Logical Bugs

### 5.1 Keyboard Shortcut Conflict: Ctrl+Shift+E

**File:** `src/App.tsx` (lines 260-266)
**Severity:** MEDIUM

The check `e.ctrlKey && e.shiftKey && e.key === "E"` may conflict with the `e.ctrlKey && e.key === "e"` check (line 253). When Shift is held, `e.key` becomes `"E"` (uppercase), so pressing Ctrl+Shift+E would match the uppercase check at line 260. However, the Ctrl+E check at line 253 uses lowercase `"e"`, so when Shift is held it won't match. This works correctly but is fragile — if the order changes, it could break.

**Fix:** Check for Shift explicitly in the Ctrl+E handler:
```tsx
if (e.ctrlKey && !e.shiftKey && e.key === "e") { ... }
```

### 5.2 Save Doesn't Update fileName

**File:** `src/App.tsx` (lines 134-163)
**Severity:** MEDIUM

When saving a new file (Save As), the code sets `setFilePath(selected)` but never calls `setFileName(...)`. The title bar will show null/undefined after saving a new file until it's reloaded.

**Fix:** Extract filename from the selected path:
```tsx
const name = selected.replace(/\\/g, '/').split('/').pop() || 'Untitled';
setFileName(name);
```

### 5.3 Export HTML Captures Stale Content

**File:** `src/App.tsx` (lines 280-292)
**Severity:** MEDIUM

The export HTML is captured with a 100ms delay. If the user triggers export within 100ms of the last content change, the export HTML will be stale. Additionally, the hidden renderer doesn't have the `components` prop (for LocalImage handling), so images won't render in the export.

### 5.4 TableOfContents Heading ID Not Matching Preview DOM

**File:** `src/components/TableOfContents.tsx` (lines 50-86)
**Severity:** MEDIUM

The TOC generates IDs like `heading-${index}-${slug}` but then searches the DOM by tag name and text content matching rather than by ID. The text matching is fragile — it uses `includes()` which could match partial headings.

**Fix:** Add IDs to heading elements in the MarkdownPreview via react-markdown's `components` prop, and scroll to them by ID.

### 5.5 WelcomeScreen Drag-Drop Uses Deprecated `file.path`

**File:** `src/components/WelcomeScreen.tsx` (line 20)
**Severity:** LOW

The code uses `// @ts-expect-error - Tauri adds path to File objects` and accesses `file.path`. This Tauri-specific extension may not work reliably across all platforms and Tauri versions.

### 5.6 Preview Line Calculation is Inaccurate

**File:** `src/components/MarkdownPreview.tsx` (lines 117-133)
**Severity:** LOW

The line calculation uses scroll percentage: `scrollPercentage * lineCount`. This is linear interpolation but markdown rendering is not linear — headings take more space, code blocks vary, images have different heights. The "Ln" display in the status bar will be inaccurate.

---

## 6. Code Architecture Issues

### 6.1 Duplicate Markdown Rendering Configuration

**File:** `src/App.tsx` (line 311), `src/components/MarkdownPreview.tsx` (lines 157-160)
**Severity:** MEDIUM

The markdown plugin configuration (`remarkGfm`, `rehypeHighlight`) is duplicated in two places. If a plugin is added/changed in one place but not the other, export output won't match preview.

**Fix:** Extract to a shared constant:
```tsx
export const markdownPlugins = { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeHighlight] };
```

### 6.2 Hardcoded Windows Path Separator

**File:** `src/components/MarkdownPreview.tsx` (line 32)
**Severity:** MEDIUM

```tsx
const fullPath = `${baseDir}\\${cleanPath.replace(/\//g, '\\')}`;
```

This hardcodes Windows backslashes. On macOS/Linux, this will break image loading.

**Fix:** Use the path separator from the runtime or handle both:
```tsx
const sep = filePath.includes('\\') ? '\\' : '/';
```

### 6.3 Export Utils Duplicates Theme Color Definitions

**File:** `src/utils/exportUtils.ts` (lines 7-72)
**Severity:** MEDIUM

Theme colors are defined in both `index.css` (CSS variables) and `exportUtils.ts` (JavaScript objects). These must be kept in sync manually. If a theme color is updated in CSS but not in the export utility, exports will look different.

**Fix:** Generate export CSS from the same source of truth, or read computed CSS variable values at export time.

---

## 7. Export System Issues

### 7.1 PDF Export Ignores Theme Colors

**File:** `src/utils/exportUtils.ts` (lines 470-476)
**Severity:** MEDIUM

The `exportToPDF` function accepts `_theme` and `_font` parameters (prefixed with underscore, meaning unused). The PDF always uses hardcoded colors (black text, light gray backgrounds) regardless of the selected theme.

### 7.2 PDF Export Doesn't Handle Tables

**File:** `src/utils/exportUtils.ts` (line 368)
**Severity:** MEDIUM

The `PDFElement` type includes common elements but `table` is not listed as a type. The `parseHTMLForPDF` function's `processNode` switch statement has no `case 'table':` handler. Tables in the markdown will either be skipped or rendered as concatenated text.

### 7.3 PDF Export Text Overlap on Long Content

**File:** `src/utils/exportUtils.ts` (lines 501-509)
**Severity:** MEDIUM

The `checkPageBreak` function only checks if the *start* of an element fits on the page. For long paragraphs or code blocks that span multiple pages, the text will overflow past the page boundary and overlap with the footer.

### 7.4 HTML Export XSS Vector

**File:** `src/utils/exportUtils.ts` (line 325)
**Severity:** LOW

The `title` variable (derived from filename) is inserted directly into the HTML without escaping:
```tsx
<title>${title}</title>
```

A filename like `"><script>alert('xss')</script>` could inject arbitrary HTML. While unlikely in a desktop app, it's a code quality concern.

**Fix:** Escape HTML entities in the title.
