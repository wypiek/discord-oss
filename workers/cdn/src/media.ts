import { cdnSettings } from "./config";
import type { CdnEnv } from "./env";
import { attachmentMediaType, safeMediaType, sniffMediaType } from "./sniff";
import { hasValidUrlSignature, isRequestSignature } from "./signing";
import { imageDimensions } from "./dimensions";

export const CDN_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; frame-ancestors 'none'";

export const API_FALLBACK_PREFIXES = new Set(["stickers", "attachments"]);
const CACHE_CONTROL = "public, max-age=21600, s-maxage=21600, immutable";
const NOT_FOUND_CACHE_CONTROL = "public, max-age=60, s-maxage=60, immutable";
const HASHED_PREFIXES = ["icons", "banners", "splashes", "discover-splashes", "discovery-splashes", "channel-icons", "team-icons", "app-icons", "app-assets"];
const ID_PREFIXES = ["emojis", "stickers", "soundboard-sounds"];
const ANIMATED_TYPES = ["image/apng", "image/gif"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml", ...ANIMATED_TYPES];
const TRANSFORMABLE = ["image/png", "image/jpeg", "image/webp", "image/avif", ...ANIMATED_TYPES];
type OutputFormat = "image/webp" | "image/png" | "image/jpeg" | "image/avif";
const OUTPUT_FORMATS: Record<string, OutputFormat> = {
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    avif: "image/avif",
};
const MAX_TRANSFORM_INPUT = 20 * 1024 * 1024;
const DISCORD_CDN = "https://cdn.discordapp.com";
const DEFAULT_SOUND_IDS = ["1", "2", "3", "4", "5", "6", "7"];

export const CDN_ROUTE_PREFIXES = [
    "attachments",
    "avatars",
    ...HASHED_PREFIXES,
    ...ID_PREFIXES,
    "guild-events",
    "role-icons",
    "guilds",
    "guild-space",
    "badge-icons",
    "content-assets",
    "avatar-decoration-presets",
    "krisp_browser_models",
    "media_channel",
    "media",
    "ping",
];

interface Lookup {
    keys: string[];
    attachment?: string;
    upstream?: { key: string; url: string };
    bundled?: string[];
    api?: boolean;
}

const strip = (segment: string) => segment.split(".")[0];

const extension = (segment: string) => (segment.includes(".") ? (segment.split(".").pop()?.toLowerCase() ?? "") : "");

const decodeSegments = (pathname: string) => {
    const segments: string[] = [];
    for (const raw of pathname.split("/").slice(1)) {
        let segment: string;
        try {
            segment = decodeURIComponent(raw);
        } catch {
            return null;
        }
        if (segment === "." || segment === ".." || /[/\\\0]/.test(segment)) return null;
        segments.push(segment);
    }
    if (segments.length > 1 && segments.at(-1) === "") segments.pop();
    return segments;
};

const resolve = (segments: string[], url: URL): Lookup | null => {
    const [prefix, first, second, third, fourth, fifth] = segments;
    const count = segments.length;
    if (prefix === "attachments" && count === 4 && /^\d+$/.test(first) && /^\d+$/.test(second) && third)
        return { keys: [`attachments/${first}/${second}/${third}`], attachment: third, api: true };
    if (prefix === "avatars") {
        if (count === 2) return { keys: [`avatars/${strip(first)}`] };
        if (count === 3) return { keys: [`avatars/${first}/${strip(second)}`] };
        if (count === 5 && second === "archived") return { keys: [`avatars/${first}/${strip(fourth)}`] };
        return null;
    }
    if (HASHED_PREFIXES.includes(prefix) || prefix === "guild-events") {
        if (count === 2 && prefix !== "guild-events") return { keys: [`${prefix}/${strip(first)}`] };
        if (count === 3) return { keys: [`${prefix}/${first}/${strip(second)}`] };
        return null;
    }
    if (prefix === "role-icons") {
        if (count === 2) return { keys: [`role-icons/${strip(first)}`] };
        if (count !== 3) return null;
        const extensions = [...new Set([extension(second), "png", "jpg", "jpeg", "webp", "svg"].filter(Boolean))];
        return { keys: extensions.map((ext) => `role-icons/${first}/${strip(second)}.${ext}`) };
    }
    if (ID_PREFIXES.includes(prefix) && count === 2) {
        const id = strip(first);
        const upstream =
            prefix === "soundboard-sounds" && DEFAULT_SOUND_IDS.includes(id) ? { key: `soundboard-sounds/${id}`, url: `${DISCORD_CDN}/soundboard-sounds/${id}` } : undefined;
        return { keys: [`${prefix}/${id}`], upstream, api: API_FALLBACK_PREFIXES.has(prefix) && /^\d+$/.test(id) };
    }
    if (prefix === "guilds" && second === "users" && (fourth === "avatars" || fourth === "banners")) {
        if (count === 5) return { keys: [`guilds/${first}/users/${third}/avatars`] };
        if (count === 6) return { keys: [`guilds/${first}/users/${third}/avatars/${strip(fifth)}`] };
        return null;
    }
    if (prefix === "guild-space" && count === 4 && second === "banner") return { keys: [`guild-space/${first}/banner/${strip(third)}`] };
    if (prefix === "badge-icons" && count === 2) {
        if (!/^[\w-]+\.png$/.test(first)) return null;
        return {
            keys: [`badge-icons/${first}`],
            bundled: [`/_meowcord/badge-icons/${first}`, `/_meowcord/badge-icons/${strip(first)}.svg`],
            upstream: /^[0-9a-f]{32}\.png$/.test(first) ? { key: `badge-icons/${first}`, url: `${DISCORD_CDN}/badge-icons/${first}` } : undefined,
        };
    }
    if (prefix === "content-assets" && count === 2 && /^[\w.-]+$/.test(first))
        return { keys: [`content-assets/${first}`], upstream: { key: `content-assets/${first}`, url: `${DISCORD_CDN}/assets/content/${first}` } };
    if (prefix === "avatar-decoration-presets" && count === 2) {
        const asset = strip(first);
        const passthrough = url.searchParams.get("passthrough") !== "false";
        return {
            keys: [`avatar-decoration-presets/${first}`],
            upstream: /^(a_)?[0-9a-f]{32}$/.test(asset)
                ? {
                      key: `avatar-decoration-presets-upstream/${asset}${passthrough ? "" : "-static"}`,
                      url: `${DISCORD_CDN}/avatar-decoration-presets/${asset}.png?size=240&passthrough=${passthrough}`,
                  }
                : undefined,
        };
    }
    if (prefix === "krisp_browser_models" && count === 3 && /^v[\w.-]{1,32}$/.test(first) && /^[\w-]{1,64}\.kw$/.test(second)) {
        const key = `krisp_browser_models/${first}/${second}`;
        return { keys: [key], upstream: { key, url: `${DISCORD_CDN}/assets/${key}` } };
    }
    if (prefix === "media_channel" && count === 2 && /^[a-z0-9_]{1,64}\.(?:mp4|webm|png|webp|gif|jpg)$/.test(first)) {
        const key = `media_channel/${first}`;
        return { keys: [key], upstream: { key, url: `${DISCORD_CDN}/assets/${key}` } };
    }
    if (prefix === "media" && first === "v1" && second === "collectibles-shop" && count === 5 && (fourth === "static" || fourth === "animated")) {
        const other = fourth === "static" ? "animated" : "static";
        return { keys: [`collectibles-shop/${third}/${fourth}`, `collectibles-shop/${third}/${other}`] };
    }
    return null;
};

const securityHeaders = (headers: Headers) => {
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", CDN_CONTENT_SECURITY_POLICY);
    headers.set("Access-Control-Allow-Origin", "*");
    return headers;
};

const notFound = (cacheControl = NOT_FOUND_CACHE_CONTROL) =>
    new Response("not found", { status: 404, headers: securityHeaders(new Headers({ "Cache-Control": cacheControl, "Content-Type": "text/plain; charset=utf-8" })) });

const httpError = (message: string, status = 400) =>
    new Response(JSON.stringify({ message, code: status }), { status, headers: securityHeaders(new Headers({ "Content-Type": "application/json" })) });

const readPrefix = async (env: CdnEnv, key: string) => {
    const head = await env.MEDIA.get(key, { range: { offset: 0, length: 512 } });
    return head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
};

const fetchUpstream = async (env: CdnEnv, ctx: ExecutionContext, upstream: { key: string; url: string }) => {
    if (!cdnSettings(env).upstream) return null;
    const stored = await env.MEDIA.get(upstream.key);
    if (stored) return { body: await stored.arrayBuffer(), type: stored.httpMetadata?.contentType ?? null };
    const response = await fetch(upstream.url, { signal: AbortSignal.timeout(15000), redirect: "manual" }).catch(() => null);
    if (!response?.ok) return null;
    const body = await response.arrayBuffer();
    const type = sniffMediaType(new Uint8Array(body.slice(0, 512))) ?? response.headers.get("content-type");
    ctx.waitUntil(
        env.MEDIA.put(upstream.key, body, { httpMetadata: type ? { contentType: type } : undefined, customMetadata: { principal: "system:cache" } }).catch(() => undefined),
    );
    return { body, type };
};

const transformOptions = (url: URL, segments: string[], sourceType: string, size: number) => {
    const clamp = (value: string | null) => {
        const number = Number(value);
        return value && Number.isFinite(number) && number > 0 ? Math.min(Math.max(Math.round(number), 16), 4096) : undefined;
    };
    const square = clamp(url.searchParams.get("size"));
    const width = clamp(url.searchParams.get("width")) ?? square;
    const height = clamp(url.searchParams.get("height")) ?? square;
    const requested = (url.searchParams.get("format") ?? extension(segments.at(-1) ?? "")).toLowerCase();
    const animatedSource = ANIMATED_TYPES.includes(sourceType);
    let format: OutputFormat | null = OUTPUT_FORMATS[requested] ?? null;
    if (requested === "gif" && animatedSource) format = width || height ? "image/webp" : null;
    if (!format && (width || height))
        format = sourceType === "image/jpeg" ? "image/jpeg" : sourceType === "image/avif" ? "image/avif" : sourceType === "image/png" ? "image/png" : "image/webp";
    if (!format || !TRANSFORMABLE.includes(sourceType) || size > MAX_TRANSFORM_INPUT) return null;
    if (!width && !height && format === sourceType) return null;
    const quality = clamp(url.searchParams.get("quality"));
    const animated = url.searchParams.get("animated") !== "false" && animatedSource;
    return { width, height, format, quality: quality ? Math.min(quality, 100) : undefined, animated };
};

const hasBody = (object: R2Object): object is R2ObjectBody => "body" in object;

const serveObject = async (env: CdnEnv, ctx: ExecutionContext, request: Request, url: URL, segments: string[], lookup: Lookup) => {
    const ranged = request.headers.has("range");
    const find = async () => {
        for (const key of lookup.keys) {
            const object = request.method === "HEAD" ? await env.MEDIA.head(key) : await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
            if (object) return { key, object };
        }
        return { key: lookup.keys.at(-1) ?? "", object: null };
    };
    let { key, object } = await find();
    const signature = cdnSettings(env).requestSignature;
    if (!object && lookup.attachment && lookup.api && env.API && signature) {
        const answer = await env.API.fetch(new Request(url, { method: "HEAD", headers: { signature } })).catch(() => null);
        await answer?.body?.cancel();
        if (answer?.ok) ({ key, object } = await find());
    }
    if (!object) {
        for (const path of lookup.bundled ?? []) {
            const bundled = await env.ASSETS?.fetch(new URL(path, url)).catch(() => null);
            if (!bundled?.ok) continue;
            const headers = securityHeaders(new Headers(bundled.headers));
            headers.set("Cache-Control", CACHE_CONTROL);
            return new Response(bundled.body, { headers });
        }
        if (lookup.api && !lookup.attachment && env.API) {
            const cache = await caches.open("meowcord-cdn");
            const cacheKey = new Request(url.toString(), { method: "GET" });
            const cached = await cache.match(cacheKey);
            if (cached) return cached;
            const answer = await env.API.fetch(new Request(url, { method: "GET" })).catch(() => null);
            if (answer?.ok) {
                const headers = securityHeaders(new Headers(answer.headers));
                headers.delete("Set-Cookie");
                headers.set("Cache-Control", CACHE_CONTROL);
                const response = new Response(answer.body, { headers });
                ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
                return request.method === "HEAD" ? new Response(null, { headers }) : response;
            }
            await answer?.body?.cancel();
        }
        const upstream = lookup.upstream && (await fetchUpstream(env, ctx, lookup.upstream));
        if (!upstream) return lookup.attachment ? httpError("File not found", 404) : notFound();
        const headers = securityHeaders(new Headers({ "Cache-Control": CACHE_CONTROL, "Content-Type": upstream.type ?? "application/octet-stream" }));
        return new Response(request.method === "HEAD" ? null : upstream.body, { headers });
    }

    let type = object.httpMetadata?.contentType ?? null;
    if (!type || type === "application/octet-stream") type = sniffMediaType(await readPrefix(env, key)) ?? type;
    if (lookup.attachment) type = attachmentMediaType(type && type !== "application/octet-stream" ? type : null, lookup.attachment);
    else type = safeMediaType(type ?? (segments[0] === "soundboard-sounds" ? "audio/mpeg" : null));

    const headers = securityHeaders(new Headers());
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", type);
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    if (!hasBody(object)) {
        if (request.method === "HEAD") headers.set("Content-Length", String(object.size));
        return new Response(null, { status: request.method === "HEAD" ? 200 : 304, headers });
    }

    const transform = env.IMAGES && !ranged && transformOptions(url, segments, type, object.size);
    if (transform && env.IMAGES) {
        const cache = await caches.open("meowcord-cdn");
        const cacheKey = new Request(url.toString(), { method: "GET" });
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        const source = await object.arrayBuffer();
        try {
            let image = env.IMAGES.input(new Response(source).body as ReadableStream<Uint8Array>);
            if (transform.width || transform.height) image = image.transform({ width: transform.width, height: transform.height, fit: "scale-down" });
            const result = await image.output({ format: transform.format, quality: transform.quality, anim: transform.animated });
            const transformedHeaders = securityHeaders(new Headers({ "Cache-Control": CACHE_CONTROL, "Content-Type": result.contentType() }));
            const transformed = new Response(await result.response().arrayBuffer(), { headers: transformedHeaders });
            ctx.waitUntil(cache.put(cacheKey, transformed.clone()));
            return transformed;
        } catch (error) {
            console.warn(`[cdn] image transform for ${key} failed, serving the original: ${error instanceof Error ? error.message : error}`);
            headers.set("Content-Length", String(object.size));
            return new Response(source, { headers });
        }
    }

    const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
    if (range && ranged) {
        const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
        const length = range.suffix ?? range.length ?? object.size - offset;
        headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set("Content-Length", String(length));
        return new Response(object.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers });
};

const md5 = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("MD5", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const snowflake = () => {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffff;
    return ((BigInt(Date.now() - 1420070400000) << 22n) | BigInt(random)).toString();
};

const publicEndpoint = (env: CdnEnv, url: URL) => (cdnSettings(env).endpointPublic || url.origin).replace(/\/+$/, "");

const upload = async (env: CdnEnv, request: Request, url: URL, segments: string[]) => {
    if (!isRequestSignature(env, request.headers.get("signature"))) return httpError("Invalid request signature", 403);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return httpError("Missing file");
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const type = sniffMediaType(bytes.subarray(0, 512));
    const size = buffer.byteLength;
    const endpoint = publicEndpoint(env, url);
    const [prefix, first, second, third, fourth] = segments;
    const store = (key: string, contentType: string | null) =>
        env.MEDIA.put(key, buffer, { httpMetadata: contentType ? { contentType } : undefined, customMetadata: { principal: request.headers.get("x-storage-principal") ?? "" } });
    const reply = (body: Record<string, unknown>) => Response.json(body);

    if (prefix === "attachments" && segments.length === 3) {
        const filename = file.name.replaceAll(" ", "_").replace(/[^a-zA-Z0-9._-]+/g, "");
        const id = snowflake();
        const path = `attachments/${first}/${id}/${filename}`;
        const contentType = file.type || type || "application/octet-stream";
        await store(path, type ?? contentType);
        const dimensions = contentType.includes("image") ? imageDimensions(bytes) : null;
        return reply({
            id,
            channel_id: first,
            message_id: second,
            content_type: contentType,
            filename,
            size,
            url: `${endpoint}/${path}`,
            path,
            width: dimensions?.width,
            height: dimensions?.height,
        });
    }

    if (ID_PREFIXES.includes(prefix) && segments.length === 2) {
        const sound = prefix === "soundboard-sounds";
        const valid = sound ? !!type && (type.startsWith("audio/") || type === "video/webm") : !!type && (IMAGE_TYPES.includes(type) || type === "application/json");
        if (!valid || !type) return httpError("Invalid file type");
        const hash = await md5(buffer);
        await store(`${prefix}/${first}`, type);
        return reply({ id: !sound && ANIMATED_TYPES.includes(type) ? `a_${hash}` : hash, content_type: type, size, url: `${endpoint}/${prefix}/${first}` });
    }

    if (!type || !IMAGE_TYPES.includes(type)) return httpError("Invalid file type");
    const hash = await md5(buffer);
    const animatedHash = ANIMATED_TYPES.includes(type) ? `a_${hash}` : hash;
    const target = (() => {
        if (prefix === "avatars" && segments.length === 2) return { key: `avatars/${first}/${animatedHash}`, id: animatedHash, url: `avatars/${first}/${animatedHash}` };
        if (HASHED_PREFIXES.includes(prefix) && segments.length === 2)
            return { key: `${prefix}/${first}/${animatedHash}`, id: animatedHash, url: `${prefix}/${first}/${animatedHash}` };
        if (prefix === "guild-events" && segments.length === 2) return { key: `guild-events/${first}/${hash}`, id: hash, url: `guild-events/${first}/${hash}` };
        if (prefix === "role-icons" && segments.length === 2) return { key: `role-icons/${first}/${hash}.png`, id: hash, url: `role-icons/${first}/${hash}` };
        if (prefix === "guilds" && second === "users" && (fourth === "avatars" || fourth === "banners") && segments.length === 5)
            return { key: `guilds/${first}/users/${third}/avatars/${animatedHash}`, id: animatedHash, url: `guilds/${first}/users/${third}/${fourth}/${animatedHash}` };
        return null;
    })();
    if (!target) return httpError("Uploads to this path are not supported on Workers", 404);
    await store(target.key, type);
    return reply({ id: target.id, content_type: type, size, url: `${endpoint}/${target.url}` });
};

const remove = async (env: CdnEnv, request: Request, segments: string[]) => {
    if (!isRequestSignature(env, request.headers.get("signature"))) return httpError("Invalid request signature");
    const [prefix, first, second, third, fourth, fifth] = segments;
    const key =
        prefix === "guilds" && second === "users" && (fourth === "avatars" || fourth === "banners") && fifth
            ? `guilds/${first}/users/${third}/avatars/${fifth}`
            : segments.length >= 2 && segments.length <= 4
              ? segments.join("/")
              : null;
    if (!key) return httpError("not found", 404);
    await env.MEDIA.delete(key);
    return Response.json({ success: true });
};

export const handleCdn = async (request: Request, env: CdnEnv, ctx: ExecutionContext): Promise<Response | null> => {
    const url = new URL(request.url);
    const prefix = url.pathname.split("/")[1];
    if (!CDN_ROUTE_PREFIXES.includes(prefix)) return null;
    const segments = decodeSegments(url.pathname);
    if (!segments) return notFound();
    if (prefix === "ping") return new Response("pong", { headers: securityHeaders(new Headers()) });
    if (prefix === "attachments" && segments.length >= 5 && env.API) return env.API.fetch(request);
    if (request.method === "POST") return upload(env, request, url, segments);
    if (request.method === "DELETE") return remove(env, request, segments);
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const lookup = resolve(segments, url);
    if (!lookup) return null;
    if (lookup.attachment && !isRequestSignature(env, request.headers.get("signature")) && cdnSettings(env).signUrls && !(await hasValidUrlSignature(env, request, url)))
        return new Response("This content is no longer available.", { status: 404, headers: securityHeaders(new Headers()) });
    return serveObject(env, ctx, request, url, segments, lookup);
};
