/**
 * English dictionary — the source of truth for both the KEYS and the words
 * (I18N-01).
 *
 * `export type Dict = typeof en` is what every other locale is typed against,
 * so a missing or misspelled key in another dictionary is a compile error
 * rather than an English string silently showing up in a Chinese UI.
 *
 * Conventions:
 *  - Nest by AREA, not by component (`menu.*`, `settings.*`, `explorer.*`), so
 *    a string used in two components has one home.
 *  - `{placeholders}` are interpolated by `t(key, { name })`.
 *  - A sentence with a `<kbd>`/`<strong>`/icon in the middle is split into
 *    `…Before` / `…Mid` / `…After` keys: the parts are reordered differently in
 *    other languages, so they cannot be assembled from one template.
 *  - A value may be a function when the sentence cannot be assembled from
 *    parts: plurals ("1 word" / "3 words"), which Chinese does not inflect,
 *    are the main case.
 */
const en = {
    common: {
        ok: "OK",
        cancel: "Cancel",
        close: "Close",
        save: "Save",
        delete: "Delete",
        rename: "Rename",
        retry: "Retry",
        copy: "Copy",
        copied: "Copied",
        loading: "Loading…",
        dismiss: "Dismiss",
    },

    // The language switcher itself lives in Settings → Appearance.
    // Confirmation/explanatory dialogs and the crash screen.
    dialog: {
        unsavedTitle: "Unsaved Changes",
        filesUnsaved: "{count} files have unsaved changes",
        changesLost: "Your changes will be lost",
        saveThem: "These files have unsaved changes. Do you want to save them before closing?",
        saveOneBefore: "Do you want to save the changes you made to ",
        saveOneAfter: "?",
        saveThemOne: "You have unsaved changes. Do you want to save them before closing?",
        discardAll: "Discard all",
        dontSave: "Don't Save",
        saveAll: "Save all",
        saveNoteTitle: "Save note",
        saveNoteBody: "Pick a name and where it should live.",
        noteName: "Note name",
        willSaveAs: "Will save as “{name}”",
        notesFolder: "Notes folder:",
        downloadsHintBefore: "Or put a copy into this device's ",
        downloads: "Downloads",
        downloadsHintAfter: " folder, where any file manager can see it.",
        saveToDownloads: "Save to Downloads",
        saveToNotes: "Save to Notes",
        updateTitle: "Update available",
        updateBodyBefore: "Paperling ",
        updateBodyMid: " is ready (you're on v",
        updateBodyEnd: ").",
        whatsNew: "What's new",
        installedRestarting: "Installed, restarting…",
        downloadingPercent: "Downloading… {percent}%",
        downloading: "Downloading…",
        updateFailed: "Update failed: {message}",
        skipVersion: "Skip this version",
        later: "Later",
        updateNow: "Update now",
        errorTitle: "Something went wrong",
        errorBody: "Paperling encountered an unexpected error. Your file data should be safe.",
        tryAgain: "Try Again",
        welcomeTour: "Welcome tour",
    },

    // The floating toolbar over a markdown table.
    tableToolbar: {
        ariaLabel: "Table editing",
        row: "Row",
        col: "Col",
        rowAbove: "Insert row above",
        rowBelow: "Insert row below",
        rowDelete: "Delete row",
        colLeft: "Insert column left",
        colRight: "Insert column right",
        colDelete: "Delete column",
        alignLeft: "Align column left",
        alignCenter: "Align column center",
        alignRight: "Align column right",
        tidy: "Tidy table (align columns)",
    },

    // The footer: save state, Ln/Col, word and character counts, reading time.
    // The counts and the reading time are functions because they inflect
    // (English "1 word" / "3 words"); Chinese does not.
    statusBar: {
        bar: "Status bar",
        filesTitle: "Files (Ctrl+Shift+E)",
        openExplorer: "Open file explorer",
        closeExplorer: "Close file explorer",
        tocTitle: "Table of Contents (Ctrl+Shift+O)",
        openToc: "Open table of contents",
        closeToc: "Close table of contents",
        backlinksTitle: "Backlinks",
        openBacklinks: "Open backlinks",
        closeBacklinks: "Close backlinks",
        fileSaved: "File saved",
        fileUnsaved: "File has unsaved changes",
        saved: "Saved",
        unsaved: "Unsaved",
        lineCol: "Ln {line}, Col {column}",
        wordCount: (p: Record<string, string | number>) =>
            `${Number(p.count).toLocaleString()} ${Number(p.count) === 1 ? "word" : "words"}`,
        selectedWords: (p: Record<string, string | number>) =>
            `${Number(p.selected).toLocaleString()} / ${Number(p.total).toLocaleString()} ${Number(p.total) === 1 ? "word" : "words"}`,
        selectedWordsAria: (p: Record<string, string | number>) =>
            `Selected ${Number(p.selected).toLocaleString()} of ${Number(p.total).toLocaleString()} words`,
        wordsAria: (p: Record<string, string | number>) => `${Number(p.count).toLocaleString()} words`,
        selectionTitle: (p: Record<string, string | number>) =>
            `Selection: ${Number(p.words).toLocaleString()} words, ${Number(p.chars).toLocaleString()} characters`,
        charsTitle: (p: Record<string, string | number>) => `${Number(p.count).toLocaleString()} characters`,
        readingTimeTitle: "Estimated reading time at 200 wpm",
        readingTime: (p: Record<string, string | number>) => {
            const min = Number(p.min);
            if (min < 1) return "< 1 min read";
            if (min < 60) return `${Math.round(min)} min read`;
            const hours = Math.floor(min / 60);
            const rem = Math.round(min % 60);
            return rem === 0 ? `${hours}h read` : `${hours}h ${rem}m read`;
        },
    },

    // The phone app bar and its ☰ sheet.
    mobileBar: {
        menu: "Menu",
        appMenu: "App menu",
        unsavedChanges: "Unsaved changes",
        paletteAria: "Search commands and notes",
    },

    // The formatting toolbar above the editor. *Title keys carry the shortcut.
    formatToolbar: {
        heading1: "Heading 1",
        heading2: "Heading 2",
        heading3: "Heading 3",
        boldTitle: "Bold ({shortcut})",
        italicTitle: "Italic ({shortcut})",
        strikethrough: "Strikethrough",
        inlineCode: "Inline code",
        bulletList: "Bullet list",
        numberedList: "Numbered list",
        taskList: "Task list",
        blockquoteTitle: "Blockquote ({shortcut})",
        linkTitle: "Link ({shortcut})",
        codeBlock: "Code block",
        insertTable: "Insert table",
        horizontalRule: "Horizontal rule",
        aiAssistTitle: "AI assist ({shortcut})",
    },

    // The open-file tab strip.
    tabBar: {
        openFiles: "Open files",
        unsavedName: "{name} (unsaved changes)",
        closeNamed: "Close {name}",
        closeDirty: "Unsaved changes — click to close",
        close: "Close",
        newTab: "New tab",
        newTabTitle: "New tab (Ctrl+N)",
    },

    // The Edit dropdown (Find / Find and Replace / Find in Files).
    editMenu: {
        ariaLabel: "Edit menu",
        label: "Edit",
        find: "Find",
        replace: "Find and Replace",
        findInFiles: "Find in Files…",
    },

    // The floating Reader / Split / Code pill.
    modeToggle: {
        group: "View mode toggle",
        reader: "Reader",
        readerAria: "Reader mode",
        readerTitle: "Reader (Ctrl+E)",
        split: "Split",
        splitAria: "Split view",
        splitTitle: "Split view (Ctrl+\\)",
        code: "Code",
        codeAria: "Code editor",
        codeTitle: "Code (Ctrl+E)",
    },

    exportMenu: {
        ariaLabel: "Export document",
        label: "Export",
        exporting: "Exporting...",
        formats: "Export formats",
        word: "Word (.docx)",
        nothing: "Nothing to export yet",
    },

    // The hover-reveal bar in Zen mode.
    zen: {
        bar: "Zen mode top bar",
        exitZen: "Exit Zen mode",
        normal: "Normal",
        normalTitle: "Back to normal view (F9)",
        outlineOpen: "Open outline",
        outlineClose: "Close outline",
        outlineTitle: "Outline (Ctrl+Shift+O)",
    },

    // Window chrome, the New/Open/Edit/Export row and the window buttons.
    titleBar: {
        dropHint: "— drop a .md file or ",
        edited: "— Edited",
        newFile: "New file",
        newFileTitle: "New File ({shortcut})",
        newLabel: "New",
        openFile: "Open file",
        openFileTitle: "Open File ({shortcut})",
        openLabel: "Open",
        aiAssistant: "AI assistant",
        minimize: "Minimize",
        maximize: "Maximize",
        exitFullscreen: "Exit fullscreen",
        exitFullscreenTitle: "Exit fullscreen (F11)",
        close: "Close",
    },

    // The quick theme/font dropdown in the title bar (the full settings modal
    // keeps its own strings under `settings`).
    settingsMenu: {
        customSystemFont: "Custom system font",
        more: "More settings…",
    },

    settings: {
        title: "Settings",
        close: "Close settings",
        searchPlaceholder: "Search…",
        searchAriaLabel: "Search settings",
        noResults: "No settings match “{query}”.",
        sectionAppearance: "Appearance",
        sectionEditor: "Editor",
        sectionShortcuts: "Shortcuts",
        sectionAi: "AI",
        sectionAbout: "About",

        // Language (I18N-01). The option names are endonyms — always shown in
        // their own language so they stay findable from either UI language.
        language: "Language",
        languageSystem: "Follow system ({language})",
        languageHint: "The language of buttons, menus and messages. Your notes are never translated.",
        languageAriaLabel: "Interface language",

        // Settings-search synonyms, per section (SET-05). Kept lowercase; the
        // search lowercases the query. Translated so Chinese users can search
        // in Chinese ("主题", "自动保存", …).
        keywords: {
            appearance: "theme dark light paper dracula graphite nord midnight accent color colour font typeface custom font size text large small language interface chinese english",
            editor: "typewriter toolbar word wrap spell check vim autosave auto save open files in reader mode readable line length preview width column zen mode text direction right to left rtl ltr arabic hebrew persian urdu",
            shortcuts: "shortcuts keyboard keybindings key bindings hotkeys rebind new file open save close tab palette go to line toggle split zen fullscreen explorer outline search settings bold italic link blockquote find replace select next occurrence",
            ai: "ai assistant endpoint model api key provider chat history openai ollama anthropic",
            about: "about version update tour guide help license",
        },

        theme: "Theme",
        themeDark: "Dark",
        themeGraphite: "Graphite",
        themeNord: "Nord",
        themeMidnight: "Midnight",
        themeLight: "Light",
        themePaper: "Paper",
        themeDracula: "Dracula",
        accentColor: "Accent color",
        accentColorAria: "Accent color: {name}",
        font: "Font",
        fontCustom: "Custom",
        fontCustomKind: "System font",
        fontCustomPlaceholder: "e.g. Atkinson Hyperlegible",
        fontCustomAria: "Custom system font family",
        fontKindSans: "Sans-serif",
        fontKindSerif: "Serif",
        fontSize: "Font size",
        fontSizeSmall: "Small",
        fontSizeMedium: "Medium",
        fontSizeLarge: "Large",
        fontSizeXlarge: "Extra large",

        typewriter: "Typewriter mode",
        typewriterHint: "Keep caret vertically centered",
        toolbar: "Show formatting toolbar",
        toolbarHint: "Toolbar above the editor",
        wordWrap: "Word wrap",
        wordWrapHint: "Wrap long lines instead of horizontal scroll",
        spellCheck: "Spell check",
        spellCheckHint: "Underline misspelled words while you type",
        vim: "Vim mode",
        vimHint: "Modal editing in the editor: h/j/k/l, modes, operators",
        autosave: "Autosave",
        autosaveHint: "Save automatically a moment after you stop typing",
        openInReader: "Open files in reader mode",
        openInReaderHint: "Every file opens read-first; editing stays one click away",
        readableLength: "Readable line length",
        readableLengthHint: "Center the reading column at a comfortable width (Obsidian-style). Off: the preview fills the window",
        zenMode: "Zen mode",
        zenModeHint: "Just the page. Ctrl+E edits, F9 exits.",

        textDirection: "Text direction",
        textDirectionHint: "Auto follows each line's language (Arabic, Hebrew, Persian… read right-to-left).",
        textDirectionShortcutHint: " In the editor, Ctrl+Right Shift switches to RTL and Ctrl+Left Shift back to Auto.",
        directionAuto: "Auto",
        directionLtr: "LTR",
        directionRtl: "RTL",

        aiEnable: "Enable AI",
        aiEnableHint: "Show the AI button and assistant in the editor",
        aiAnimateIcon: "Animate the AI icon",
        aiAnimateIconHint: "Shimmer on the title-bar AI button; off shows it as plain text",
        aiIntroBefore:
            "Configure an OpenAI-compatible endpoint to enable inline AI assist (Rewrite / Shorten / Expand / Continue / Translate). Open it in the editor with ",
        aiIntroBetween: ", the ",
        aiIntroAfter: " toolbar button, or the command palette.",
        aiStatusInvalidEndpoint: "Invalid endpoint",
        aiStatusInsecure: "Insecure endpoint",
        aiStatusReady: "Ready",
        aiStatusUnconfigured: "Not configured",
        aiProvider: "Provider",
        aiProviderPresets: "AI provider presets",
        aiProviderHint:
            "Pick a provider to fill in the endpoint and model; then just paste your API key. Any other OpenAI-compatible endpoint works too, entered below.",
        aiProviderNameGemini: "Google Gemini",
        aiProviderNameOpenai: "OpenAI",
        aiProviderNameOllama: "Ollama (local)",
        aiProviderNameLmstudio: "LM Studio (local)",
        aiKeyHintGemini: "Get a free key at aistudio.google.com/apikey and paste it above.",
        aiKeyHintOpenai: "Create a key at platform.openai.com/api-keys and paste it above.",
        aiKeyHintOllama: "No key needed. Everything stays on your machine.",
        aiKeyHintLmstudio:
            "No key needed. Start the server in LM Studio's Developer tab; set Model to the loaded model's API identifier if requests are rejected.",
        aiEndpoint: "Endpoint URL",
        aiEndpointPlaceholder: "https://api.openai.com/v1/chat/completions",
        aiEndpointInvalid: "Must be a valid http:// or https:// URL.",
        aiEndpointInsecure:
            "An API key would be sent unencrypted to this host. Use https://, or clear the key if this server does not need one.",
        aiModel: "Model",
        aiModelPlaceholder: "gpt-4o-mini, claude-haiku-4-5, llama3, …",
        aiApiKey: "API key",
        aiApiKeyNeeded: "paste your {provider} API key",
        aiApiKeyOptional: "(optional for local providers)",
        aiApiKeyNotNeeded: "(not needed for this provider)",
        aiHistoryDepth: "Chat history depth",
        aiHistoryHint:
            "How many previous chat turns are sent with each AI panel message. Lower saves tokens; 0 makes every message start fresh. The document itself is always attached only to the newest message.",
        aiTest: "Test connection",
        aiTesting: "Testing…",
        aiTestOk: "✓ Connection OK",
        aiPrivacyLead: "Privacy: your selected text is sent ",
        aiPrivacyUnencrypted: "unencrypted",
        aiPrivacyMid: " to the endpoint you configure above. For private notes, use a local provider (e.g. Ollama at ",
        aiPrivacyTail:
            ") so nothing leaves your machine. The API key is stored in your operating system's keychain (Windows Credential Manager, macOS Keychain, or Linux Secret Service), not in plaintext.",

        aboutTagline: "A minimal markdown editor",
        aboutBuiltWith: "Built with Tauri + React + TypeScript.",
        aboutCreatedBy: "Created by",
        aboutShortcutHintBefore: "Press ",
        aboutShortcutHintAfter: " to view all keyboard shortcuts.",
        aboutReplayTour: "Replay the welcome tour",
        aboutReplayTourHint: "A 30-second walkthrough of the editor, views, and shortcuts",
    },
};

export type Dict = typeof en;
export default en;
