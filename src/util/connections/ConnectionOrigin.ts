export type OriginSource = "connectionsOrigin" | "apiEndpoint" | "serverName" | "frontPage";

const originOf = (value: string | null | undefined) => {
    if (!value || !/^https?:\/\//i.test(value)) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

export function resolveConnectionOrigin(
    general: { serverName?: string | null; frontPage?: string | null },
    api: { connectionsOrigin?: string | null; endpointPublic?: string | null },
): { origin: string; source: OriginSource | null } {
    const serverName = general.serverName && !/^https?:\/\//i.test(general.serverName) ? `https://${general.serverName}` : general.serverName;
    const candidates: [OriginSource, string | null | undefined][] = [
        ["connectionsOrigin", api.connectionsOrigin],
        ["apiEndpoint", api.endpointPublic],
        ["serverName", serverName],
        ["frontPage", general.frontPage],
    ];
    for (const [source, value] of candidates) {
        const origin = originOf(value);
        if (origin) return { origin, source };
    }
    return { origin: "", source: null };
}

export function normalizeConnectionsOrigin(value: unknown): string | null | undefined {
    if (value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 253 || /\s/.test(value)) return undefined;
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
        return url.origin;
    } catch {
        return undefined;
    }
}
