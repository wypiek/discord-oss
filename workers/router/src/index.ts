import { handleCdn } from "../../cdn/src/media";
import { handleClient } from "./client";
import type { RouterEnv } from "./env";

const API_ROOTS = new Set([
    "api",
    ".well-known",
    "%2Ewell-known",
    "healthz",
    "readyz",
    "_spacebar",
    "__development",
    "error-reporting-proxy",
    "federation",
    "imageproxy",
    "external",
    "klipy",
    "terms",
    "tos",
    "privacy",
    "guidelines",
    "widget",
    "rtc",
    "remote-auth",
]);

const API_STATIC = /^\/static\/email\//;

const BUNDLED_FILES = [
    {
        pattern: /^\/api(?:\/v(?:6|7|8|9|10))?\/auth\/cap\/(widget\.js|wasm-hashes\.min\.js|cap_wasm_bg\.wasm|hashwx\.wasm|pako\.js)$/,
        folder: "cap",
        cacheControl: "public, max-age=3600",
    },
    { pattern: /^\/_spacebar\/api\/(openapi\.json|schemas\.json)$/, folder: "api", cacheControl: "public, max-age=21600" },
];

const bundledFile = async (request: Request, env: RouterEnv, pathname: string) => {
    if (request.method !== "GET" && request.method !== "HEAD") return undefined;
    for (const { pattern, folder, cacheControl } of BUNDLED_FILES) {
        const name = pathname.match(pattern)?.[1];
        if (!name) continue;
        const asset = await env.ASSETS.fetch(new Request(new URL(`/_meowcord/${folder}/${name}`, request.url), { method: request.method }));
        if (!asset.ok) return undefined;
        const response = new Response(asset.body, asset);
        response.headers.set("Cache-Control", cacheControl);
        return response;
    }
    return undefined;
};

export const CDN_FALLBACK_ROOTS = new Set(["clan-badges", "embed", "federation-media", "federation-upload", "detectables", "changelogs", "bad-domains", "media"]);

const unavailable = (service: string) =>
    new Response(JSON.stringify({ message: `The ${service} service is not bound to this worker`, code: 0 }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "5" },
    });

const forward = async (binding: Fetcher | undefined, service: string, request: Request) => {
    if (!binding) return unavailable(service);
    try {
        return await binding.fetch(request);
    } catch (error) {
        console.warn(`[router] ${service} failed: ${error instanceof Error ? error.message : error}`);
        return unavailable(service);
    }
};

export const route = (pathname: string, upgrade: boolean) => {
    if (upgrade) return "gateway";
    const root = pathname.split("/")[1];
    if (root === "_meowcord") return "hidden";
    if (pathname === "/" || API_ROOTS.has(root) || API_STATIC.test(pathname)) return "api";
    return "edge";
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const target = route(url.pathname, request.headers.get("upgrade")?.toLowerCase() === "websocket");
        if (target === "gateway") return forward(env.GATEWAY, "gateway", request);
        if (target === "hidden") return new Response("Not Found", { status: 404 });
        if (target === "api") return (await bundledFile(request, env, url.pathname)) ?? forward(env.API, "api", request);
        const media = await handleCdn(request, env, ctx);
        if (media) return media;
        if (CDN_FALLBACK_ROOTS.has(url.pathname.split("/")[1])) return forward(env.API, "api", request);
        const page = await handleClient(request, env);
        if (page) return page;
        return forward(env.API, "api", request);
    },
} satisfies ExportedHandler<RouterEnv>;
