import { streamChat } from "./aiChat";
import type { AIConfig } from "./aiConfig";
export { isValidEndpoint, endpointLeaksKey, INSECURE_KEY_MESSAGE, type AIConfig } from "./aiConfig";

export type AIAction = "rewrite" | "shorten" | "expand" | "continue" | "translate";

const SYSTEM_PROMPTS: Record<AIAction, string> = {
    rewrite: "Rewrite the user's text for clarity and flow. Output the rewritten text only — no preface, no quotes, no explanation.",
    shorten: "Shorten the user's text to about half the length while keeping the meaning. Output the shortened text only.",
    expand: "Expand the user's text with more detail and context. Output the expanded text only.",
    continue: "Continue writing in the same style and tone. Output only the continuation, not the original.",
    translate: "Translate the user's text to English. Output the translation only.",
};

/** AI-07 (#229): share chat streaming and its 120-second header budget.
 * Slow local generation has no total deadline; Stop cancels it explicitly. */
export async function runAIAction(action: AIAction, text: string, cfg: AIConfig, signal?: AbortSignal, onToken?: (delta: string) => void): Promise<string> {
 const full = await streamChat([{ role: "system", content: SYSTEM_PROMPTS[action] }, { role: "user", content: text }], cfg, { signal, onToken, temperature: 0.7 });
 const output = full.trim();
 if (!output) throw new Error("AI returned an empty response.");
 return output.length > 200_000 ? output.slice(0, 200_000) + "\n\n[Response truncated]" : output;
}
