import { cdnSettings } from "./config";
import type { CdnEnv } from "./env";

const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const equal = (a: string, b: string) => {
    const left = encoder.encode(a);
    const right = encoder.encode(b);
    return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
};

export const isRequestSignature = (env: CdnEnv, value: string | null) => {
    const expected = cdnSettings(env).requestSignature;
    return !!value && !!expected && equal(value, expected);
};

export const hasValidUrlSignature = async (env: CdnEnv, request: Request, url: URL) => {
    const settings = cdnSettings(env);
    const key = settings.signatureKey;
    const expiresAt = url.searchParams.get("ex");
    const issuedAt = url.searchParams.get("is");
    const hash = url.searchParams.get("hm");
    if (!key || !expiresAt || !issuedAt || !hash) return false;
    const issued = Number.parseInt(issuedAt, 16);
    const expires = Number.parseInt(expiresAt, 16);
    const now = Date.now();
    if (Number.isNaN(issued) || Number.isNaN(expires) || expires < now || issued >= now) return false;
    const parts = [url.pathname, issuedAt, expiresAt];
    if (settings.includeIp) {
        const ip = request.headers.get("cf-connecting-ip");
        if (ip) parts.push(ip);
    }
    if (settings.includeUserAgent) {
        const userAgent = request.headers.get("user-agent");
        if (userAgent) parts.push(userAgent);
    }
    const hmac = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return equal(hex(await crypto.subtle.sign("HMAC", hmac, encoder.encode(parts.join("")))), hash);
};
