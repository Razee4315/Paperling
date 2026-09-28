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
