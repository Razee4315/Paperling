export interface AIConfig {
    endpoint: string;
    model: string;
    apiKey: string;
}

export function isValidEndpoint(raw: string): boolean {
    try { return ["http:", "https:"].includes(new URL(raw).protocol); }
    catch { return false; }
}

function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** AI-04: keyless LAN models are supported, but credentials must never cross
 * the network in cleartext. Both editor actions and chat use this guard. */
export function endpointLeaksKey(endpoint: string, apiKey: string | undefined | null): boolean {
    if (!apiKey) return false;
    try {
        const url = new URL(endpoint);
        return url.protocol === "http:" && !isLoopbackHost(url.hostname);
    } catch { return false; }
}

export const INSECURE_KEY_MESSAGE = "Refusing to send your API key unencrypted to a remote host. Use an https:// endpoint, or clear the API key if this server does not need one.";
