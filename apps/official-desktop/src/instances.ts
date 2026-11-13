export interface SavedInstance {
    url: string;
    name: string;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local|[^.]+\.localhost)(:\d+)?$/i;

export function normalizeInstanceUrl(input: string): string {
    const text = input.trim();
    if (!text) throw new Error("Enter the address of a Discord OSS instance.");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${LOCAL_HOST.test(text.split("/")[0]) ? "http" : "https"}://${text}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https addresses work.");
    return url.origin;
}

export function backendSettings(settings: Record<string, unknown>, origin: string | null) {
    const next = { ...settings };
    if (origin) {
        next.WEBAPP_ENDPOINT = origin;
        next.API_ENDPOINT = `${origin}/api`;
    } else {
        delete next.WEBAPP_ENDPOINT;
        delete next.API_ENDPOINT;
    }
    return next;
}

export function currentInstance(settings: Record<string, unknown>) {
    const endpoint = settings.WEBAPP_ENDPOINT;
    if (typeof endpoint !== "string" || !endpoint) return null;
    try {
        return normalizeInstanceUrl(endpoint);
    } catch {
        return null;
    }
}

export function rememberInstance(list: SavedInstance[], instance: SavedInstance) {
    return [instance, ...list.filter((saved) => saved.url !== instance.url)].slice(0, 20);
}

export async function discoverInstance(input: string, fetcher: (url: string) => Promise<Response>): Promise<SavedInstance> {
    const origin = normalizeInstanceUrl(input);
    const host = new URL(origin).host;
    let response: Response;
    try {
        response = await fetcher(`${origin}/.well-known/discord-oss`);
    } catch {
        throw new Error(`Couldn't reach ${host}. Check the address and your connection.`);
    }
    if (!response.ok) throw new Error(`${host} isn't a Discord OSS instance (HTTP ${response.status}).`);
    const body = (await response.json().catch(() => null)) as { software?: { name?: string }; instance?: { url?: string; name?: string } } | null;
    if (body?.software?.name !== "discord-oss") throw new Error(`${host} isn't a Discord OSS instance.`);
    const url = body.instance?.url ? new URL(body.instance.url).origin : origin;
    return { url, name: body.instance?.name?.trim() || new URL(url).host };
}
