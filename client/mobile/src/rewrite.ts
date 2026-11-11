export type Endpoints = { api: string; gateway: string; cdn: string; media: string };

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export const endpointsFromOrigin = (origin: string): Endpoints => {
    const base = trimSlash(origin);
    return { api: `${base}/api`, gateway: base.replace(/^http/, "ws"), cdn: base, media: base };
};

export const createRewriter = (endpoints: Endpoints) => {
    const rules: [RegExp, string][] = [
        [/https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?=[/?#"'\s)<>,\]]|$)/gi, trimSlash(endpoints.api).replace(/\/v\d+$/, "")],
        [/wss?:\/\/gateway(?:-[a-z0-9-]+)?\.discord\.gg(?=[/?#"'\s)<>,\]]|$)/gi, trimSlash(endpoints.gateway)],
        [/https?:\/\/cdn\.discordapp\.com(?=[/?#"'\s)<>,\]]|$)/gi, trimSlash(endpoints.cdn)],
        [/https?:\/\/media\.discordapp\.net(?=[/?#"'\s)<>,\]]|$)/gi, trimSlash(endpoints.media)],
    ];
    return (text: string) => rules.reduce((next, [pattern, target]) => next.replace(pattern, () => target), text);
};

const MAX_TEXT_LENGTH = 16 * 1024 * 1024;

const mentionsDiscord = (value: string) => value.length >= 12 && value.length <= MAX_TEXT_LENGTH && value.includes("discord");

export const rewriteValue = (value: unknown, rewrite: (url: string) => string, depth: number): unknown => {
    if (typeof value === "string") return mentionsDiscord(value) ? rewrite(value) : value;
    if (depth <= 0 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        let copy: unknown[] | undefined;
        for (let i = 0; i < value.length; i++) {
            const next = rewriteValue(value[i], rewrite, depth - 1);
            if (next === value[i]) continue;
            copy ??= value.slice();
            copy[i] = next;
        }
        return copy ?? value;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return value;
    let copy: Record<string, unknown> | undefined;
    const record = value as Record<string, unknown>;
    for (const key in record) {
        const next = rewriteValue(record[key], rewrite, depth - 1);
        if (next === record[key]) continue;
        copy ??= { ...record };
        copy[key] = next;
    }
    return copy ?? value;
};
