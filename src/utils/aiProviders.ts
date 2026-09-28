// Provider presets for the AI settings page: picking one fills the endpoint
// and a sensible default model, leaving only the API key to paste. Every
// preset speaks the OpenAI Chat Completions protocol (Gemini through its
// OpenAI-compatibility layer), which is the one protocol the app implements,
// so no per-provider request code exists or is needed. AI-05.

export interface AIProvider {
    id: string;
    name: string;
    endpoint: string;
    defaultModel: string;
    /** Shown under the API key field while this provider is selected. */
    keyHint: string;
    /** Local providers need no key; relaxes the field's placeholder. */
    keyOptional?: boolean;
}

export const AI_PROVIDERS: AIProvider[] = [
    {
        id: "gemini",
        name: "Google Gemini",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        defaultModel: "gemini-3.6-flash",
        keyHint: "Get a free key at aistudio.google.com/apikey and paste it above.",
    },
    {
        id: "openai",
        name: "OpenAI",
        endpoint: "https://api.openai.com/v1/chat/completions",
        defaultModel: "gpt-4o-mini",
        keyHint: "Create a key at platform.openai.com/api-keys and paste it above.",
    },
    {
        id: "ollama",
        name: "Ollama (local)",
        endpoint: "http://localhost:11434/v1/chat/completions",
        defaultModel: "llama3.2",
        keyHint: "No key needed. Everything stays on your machine.",
        keyOptional: true,
    },
    {
        id: "lmstudio",
        name: "LM Studio (local)",
        endpoint: "http://localhost:1234/v1/chat/completions",
        // LM Studio has no universal model id — recent versions route unknown
        // names to the loaded model, older ones want the model's API identifier.
        defaultModel: "local-model",
        keyHint: "No key needed. Start the server in LM Studio's Developer tab; set Model to the loaded model's API identifier if requests are rejected.",
        keyOptional: true,
    },
];

const normalize = (url: string) => url.trim().replace(/\/+$/, "");

/** The preset whose endpoint matches, or null (empty or hand-configured). */
export function matchProvider(endpoint: string): AIProvider | null {
    const e = normalize(endpoint);
    if (!e) return null;
    return AI_PROVIDERS.find((p) => normalize(p.endpoint) === e) ?? null;
}
