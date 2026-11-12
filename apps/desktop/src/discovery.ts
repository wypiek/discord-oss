import { net } from "electron";

export interface InstanceInfo {
    url: string;
    name: string;
    icon: string | null;
}

interface WellKnown {
    software?: { name?: string };
    instance?: { url?: string; name?: string; icon?: string };
}

const localHost = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local|[^.]+\.localhost)(:\d+)?$/i;

export function normalizeInstanceUrl(input: string): string {
    const text = input.trim();
    if (!text) throw new Error("Enter the address of a Discord OSS instance.");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${localHost.test(text.split("/")[0]) ? "http" : "https"}://${text}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https addresses work.");
    return url.origin;
}

export async function discoverInstance(input: string): Promise<InstanceInfo> {
    const origin = normalizeInstanceUrl(input);
    let response: Response;
    try {
        response = await net.fetch(`${origin}/.well-known/discord-oss`, { headers: { accept: "application/json" } });
    } catch {
        throw new Error(`Couldn't reach ${new URL(origin).host}. Check the address and your connection.`);
    }
    if (!response.ok) throw new Error(`${new URL(origin).host} isn't a Discord OSS instance (HTTP ${response.status}).`);
    const body = (await response.json().catch(() => null)) as WellKnown | null;
    if (body?.software?.name !== "discord-oss") throw new Error(`${new URL(origin).host} isn't a Discord OSS instance.`);
    const url = body.instance?.url ? new URL(body.instance.url).origin : origin;
    return { url, name: body.instance?.name?.trim() || new URL(url).host, icon: body.instance?.icon ?? null };
}
