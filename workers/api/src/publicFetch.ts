import { isIP } from "node:net";

interface Limits {
    maxBytes?: number;
    timeoutMs?: number;
    trustedCdnOrigin?: string;
    allowExternal?: boolean;
}

interface Helpers {
    allowPrivate: () => boolean;
    isPrivateAddress: (address: string) => boolean;
    isTrustedCdnAsset: (url: URL, origin?: string) => boolean;
    timeoutError: (message: string, cause?: unknown) => Error;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const crossOriginHeaders = ["authorization", "proxy-authorization", "cookie", "cookie2", "x-api-key", "x-auth-token", "x-access-token", "signature", "referer", "origin"];

const readLimited = async (response: Response, maxBytes: number) => {
    const length = response.headers.get("content-length");
    if (length && Number(length) > maxBytes) throw new Error("Public response exceeds byte limit");
    if (!response.body) return null;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            await reader.cancel();
            throw new Error("Public response exceeds byte limit");
        }
        parts.push(value);
    }
    return Buffer.concat(parts);
};

export const workersPublicFetch =
    (helpers: Helpers) =>
    async (url: string, init: RequestInit, redirects: number, limits: Limits): Promise<Response> => {
        const maxBytes = limits.maxBytes ?? 5 * 1024 * 1024;
        const timeoutMs = limits.timeoutMs ?? 15000;
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        let target = new URL(url);
        let method = (init.method ?? "GET").toUpperCase();
        let headers = new Headers(init.headers);
        let body = init.body ?? undefined;
        for (let remaining = redirects; ; remaining--) {
            if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Invalid public HTTP URL");
            if (limits.allowExternal === false && !helpers.isTrustedCdnAsset(target, limits.trustedCdnOrigin)) throw new Error("External public requests are disabled");
            const host = target.hostname.replace(/^\[|\]$/g, "");
            if (isIP(host) && helpers.isPrivateAddress(host) && !helpers.allowPrivate() && !helpers.isTrustedCdnAsset(target, limits.trustedCdnOrigin))
                throw new Error("Public URL resolves to a forbidden address");
            const response = await fetch(target, { method, headers, body, redirect: "manual", signal }).catch((error) => {
                if (timeout.aborted && !init.signal?.aborted) throw helpers.timeoutError(`${target.host} didn't answer within ${Math.round(timeoutMs / 1000)} seconds`, error);
                throw error;
            });
            const location = response.headers.get("location");
            if (redirectStatuses.has(response.status) && location && init.redirect !== "manual") {
                await response.body?.cancel();
                if (init.redirect === "error") throw new Error("Public redirect refused");
                if (remaining <= 0) throw new Error("Too many public redirects");
                if (!URL.canParse(location, target)) throw new Error("Invalid public redirect");
                const next = new URL(location, target);
                headers = new Headers(headers);
                if (next.origin !== target.origin) for (const name of crossOriginHeaders) headers.delete(name);
                const nextMethod = (response.status === 303 && method !== "HEAD") || ([301, 302].includes(response.status) && method === "POST") ? "GET" : method;
                if (nextMethod !== method) {
                    for (const name of ["content-type", "content-length", "content-encoding"]) headers.delete(name);
                    body = undefined;
                }
                method = nextMethod;
                target = next;
                continue;
            }
            const data = method === "HEAD" || [204, 205, 304].includes(response.status) ? null : await readLimited(response, maxBytes);
            const result = new Response(data, { status: response.status, headers: response.headers });
            Object.defineProperties(result, { url: { value: target.href }, redirected: { value: target.href !== new URL(url).href } });
            return result;
        }
    };
