import { appMetaTags, type ClientEnvSettings, type ClientJoinReason, clientEnvScript, escapeTitle, finishClientHtml, vencordScriptTag } from "../../../src/bundle/ClientHtml";
import { APP_THEME_COLOR, BRANDED_CLIENT_ASSETS, brandPageMarkup } from "../../../src/util/util/BrandMarkup";
import { DEFAULT_INSTANCE_NAME } from "../../../src/util/config/types/ClientConfiguration";
import { type InstanceConfig, instanceConfig } from "../../cdn/src/config";
import type { RouterEnv } from "./env";

interface ClientBundle {
    html: string;
    base: Record<string, unknown>;
    patches: string;
    vencordHash: string | null;
    roots: string[] | null;
    versionHash: string | null;
}

export interface InstanceSettings {
    instanceName: string;
    instanceId: string | null;
    iconUrl: string | null;
    logoUrl: string | null;
    helpUrl: string | null;
    activityApplicationHost: string | null;
    loadingTips: string[] | null;
    loadingSvg: string | null;
    allowSlowmodeBypass: boolean;
    e2eeTrustServer: boolean;
    maxGroupDmRecipients: number;
    emailRequired: boolean;
    joinReason: ClientJoinReason | null;
    cdnEndpoint: string | null;
}

const DEFAULT_SETTINGS: InstanceSettings = {
    instanceName: DEFAULT_INSTANCE_NAME,
    instanceId: null,
    iconUrl: null,
    logoUrl: null,
    helpUrl: null,
    activityApplicationHost: null,
    loadingTips: null,
    loadingSvg: null,
    allowSlowmodeBypass: false,
    e2eeTrustServer: true,
    maxGroupDmRecipients: 25,
    emailRequired: false,
    joinReason: null,
    cdnEndpoint: null,
};

const SETTINGS_TTL = 60_000;
const NO_CACHE = { "Cache-Control": "no-cache" };
const PAGES: Record<string, string> = { "/admin": "admin", "/status": "status", "/appeal": "appeal", "/verify-email": "verify" };

let bundle: Promise<ClientBundle | null> | null = null;
let remoteSettings: { at: number; value: Promise<Partial<InstanceSettings> | null> } | null = null;
let rendered: { stamp: string; html: string; etag: string } | null = null;
const iconDataUris = new Map<string, Promise<string | null>>();

const asset = (env: RouterEnv, path: string, url: URL) => env.ASSETS.fetch(new URL(path, url.origin));

const loadBundle = (env: RouterEnv, url: URL) => {
    bundle ??= asset(env, "/_meowcord/client.json", url).then((response) => (response.ok ? (response.json() as Promise<ClientBundle>) : null));
    return bundle;
};

const isWebUrl = (value: unknown): value is string => typeof value === "string" && /^https?:\/\//i.test(value.trim());

const instanceIdFromUrl = (value: string | null | undefined) => {
    if (!value || !URL.canParse(value)) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return port === "443" ? url.hostname.toLowerCase() : `${url.hostname.toLowerCase()}:${port}`;
};

const instanceUrl = ({ general, api }: InstanceConfig) => {
    const server = general?.serverName?.trim();
    if (server && /^https?:\/\//.test(server) && URL.canParse(server)) return new URL(server).origin;
    if (server && /^[a-z0-9.-]+(?::\d+)?$/i.test(server)) return `https://${server.toLowerCase()}`;
    const endpoint = api?.endpointPublic;
    return endpoint && URL.canParse(endpoint) ? new URL(endpoint).origin : null;
};

const settingsFromConfig = (config: InstanceConfig): Partial<InstanceSettings> => {
    const { client, general, limits, register, cdn } = config;
    const joinReason = register?.joinReason;
    const settings: Partial<InstanceSettings> = {
        instanceName: client?.instanceName || general?.instanceName || undefined,
        instanceId: instanceIdFromUrl(instanceUrl(config)),
        iconUrl: client?.icon || general?.image || null,
        logoUrl: client?.logo ?? null,
        helpUrl: client?.helpUrl ?? null,
        activityApplicationHost: client?.activityApplicationHost ?? null,
        loadingTips: client?.loadingTips ?? null,
        loadingSvg: client?.loadingSvg ?? null,
        allowSlowmodeBypass: limits?.channel?.allowSlowmodeBypass,
        e2eeTrustServer: limits?.e2ee?.trustServerByDefault,
        maxGroupDmRecipients: limits?.channel?.maxGroupDmRecipients,
        emailRequired: register?.email?.required,
        joinReason:
            joinReason?.required || register?.requireApproval
                ? {
                      required: !!joinReason?.required,
                      minLength: joinReason?.required ? (joinReason.minLength ?? 20) : 0,
                      maxLength: joinReason?.maxLength ?? 1000,
                      approval: !!register?.requireApproval,
                  }
                : null,
        cdnEndpoint: cdn?.endpointPublic ?? null,
    };
    return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
};

export const instanceSettings = async (env: RouterEnv): Promise<InstanceSettings> => {
    const configured = settingsFromConfig(instanceConfig(env));
    try {
        Object.assign(configured, env.CLIENT_SETTINGS ? JSON.parse(env.CLIENT_SETTINGS) : {});
    } catch {
        console.warn("[router] CLIENT_SETTINGS is not valid JSON, ignoring it");
    }
    if (env.INSTANCE_NAME) configured.instanceName = env.INSTANCE_NAME;
    if (env.CLIENT_SETTINGS_PATH && env.API) {
        if (!remoteSettings || Date.now() - remoteSettings.at > SETTINGS_TTL) {
            const value = env.API.fetch(new Request(new URL(env.CLIENT_SETTINGS_PATH, "https://api.internal")))
                .then((response) => (response.ok ? (response.json() as Promise<Partial<InstanceSettings>>) : null))
                .catch(() => null);
            remoteSettings = { at: Date.now(), value };
        }
        Object.assign(configured, (await remoteSettings.value) ?? {});
    }
    const settings = { ...DEFAULT_SETTINGS, ...configured };
    return {
        ...settings,
        iconUrl: isWebUrl(settings.iconUrl) ? settings.iconUrl.trim() : null,
        logoUrl: isWebUrl(settings.logoUrl) ? settings.logoUrl.trim() : null,
        helpUrl: isWebUrl(settings.helpUrl) ? settings.helpUrl.trim() : null,
    };
};

const shortHash = async (value: string) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 8);

const brandImageUrls = async (settings: InstanceSettings) => ({
    icon: settings.iconUrl ? `/static/logo.png?v=${await shortHash(JSON.stringify({ url: settings.iconUrl }))}` : null,
    logo: settings.logoUrl ? `/static/wordmark?v=${await shortHash(JSON.stringify({ url: settings.logoUrl }))}` : null,
});

const appIconUrl = async (settings: InstanceSettings, size: number) => `/assets/pwa/icon-${size}.png?v=${await shortHash(settings.iconUrl ?? "default")}`;

const iconDataUri = (settings: InstanceSettings) => {
    const source = settings.iconUrl;
    if (!source) return Promise.resolve(null);
    let pending = iconDataUris.get(source);
    if (!pending) {
        pending = fetch(source, { signal: AbortSignal.timeout(5000) })
            .then(async (response) => {
                const type = response.headers.get("content-type") ?? "";
                if (!response.ok || !type.startsWith("image/")) return null;
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.byteLength > 2 * 1024 * 1024) return null;
                let binary = "";
                for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
            })
            .catch(() => null);
        iconDataUris.set(source, pending);
    }
    return pending;
};

const renderClient = async (client: ClientBundle, settings: InstanceSettings) => {
    const stamp = JSON.stringify(settings);
    if (rendered?.stamp === stamp) return rendered;
    const images = await brandImageUrls(settings);
    const envSettings: ClientEnvSettings = {
        instanceName: settings.instanceName,
        instanceId: settings.instanceId,
        activityApplicationHost: settings.activityApplicationHost,
        loadingTips: settings.loadingTips,
        loadingSvg: settings.loadingSvg,
        icon: images.icon,
        logo: images.logo,
        helpUrl: settings.helpUrl,
        allowSlowmodeBypass: settings.allowSlowmodeBypass,
        e2eeTrustServer: settings.e2eeTrustServer,
        maxGroupDmRecipients: settings.maxGroupDmRecipients,
        emailRequired: settings.emailRequired,
        joinReason: settings.joinReason,
    };
    const title = escapeTitle(settings.instanceName);
    const inject = `${clientEnvScript(client.base, envSettings)}\n${vencordScriptTag(client.vencordHash)}\n${client.patches}`;
    const html = finishClientHtml(client.html, inject, title, appMetaTags(title, await appIconUrl(settings, 180)));
    const etag = `"${await shortHash(html)}${await shortHash(`${html}:2`)}"`;
    rendered = { stamp, html, etag };
    return rendered;
};

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_CACHE, ...headers } });

const brandPage = async (env: RouterEnv, url: URL, name: string, settings: InstanceSettings) => {
    const page = await asset(env, `/_meowcord/pages/${name}.html`, url);
    if (!page.ok) return null;
    return brandPageMarkup(await page.text(), settings.instanceName, (await brandImageUrls(settings)).icon);
};

const appManifest = async (settings: InstanceSettings) => {
    const name = settings.instanceName;
    const icons = [];
    for (const size of [192, 512])
        for (const purpose of ["any", "maskable"]) icons.push({ src: await appIconUrl(settings, size), sizes: `${size}x${size}`, type: "image/png", purpose });
    return {
        id: "/app",
        name,
        short_name: name,
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: APP_THEME_COLOR,
        theme_color: APP_THEME_COLOR,
        icons,
    };
};

const appIcon = async (env: RouterEnv, url: URL, settings: InstanceSettings, size: number) => {
    const source = settings.iconUrl ? await fetch(settings.iconUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null) : await asset(env, "/_meowcord/icon.png", url);
    const fallback = () => asset(env, "/_meowcord/icon.png", url);
    if (!source?.ok || !source.body) return fallback();
    if (!env.IMAGES) return settings.iconUrl ? Response.redirect(settings.iconUrl, 302) : source;
    try {
        const custom = !!settings.iconUrl;
        const inner = custom ? Math.round(size * 0.62) : size;
        const image = env.IMAGES.input(source.body as ReadableStream<Uint8Array>).transform({ width: inner, height: inner, fit: "contain" });
        const padded = custom ? image.transform({ width: size, height: size, fit: "pad", background: APP_THEME_COLOR }) : image;
        const result = await padded.output({ format: "image/png" });
        return new Response(result.image(), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=21600" } });
    } catch (error) {
        console.warn(`[router] app icon render failed: ${error instanceof Error ? error.message : error}`);
        return fallback();
    }
};

export const handleClient = async (request: Request, env: RouterEnv): Promise<Response | null> => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const url = new URL(request.url);
    const path = url.pathname;
    const settings = await instanceSettings(env);

    if (["/assets/favicon.ico", "/favicon.ico", "/assets/favicon.svg", "/favicon.svg"].includes(path)) {
        if (settings.iconUrl) return new Response(null, { status: 302, headers: { Location: settings.iconUrl, ...NO_CACHE } });
        const favicon = await asset(env, "/assets/branding/favicon.svg", url);
        return new Response(favicon.body, { headers: { "Content-Type": "image/svg+xml", ...NO_CACHE } });
    }
    if (path === "/manifest.webmanifest" || path === "/manifest.json")
        return new Response(JSON.stringify(await appManifest(settings)), { headers: { "Content-Type": "application/manifest+json", ...NO_CACHE } });
    const pwa = /^\/assets\/pwa\/icon-(180|192|512)\.png$/.exec(path);
    if (pwa) return appIcon(env, url, settings, Number(pwa[1]));
    if (path === "/static/logo.png") {
        if (settings.iconUrl) return new Response(null, { status: 302, headers: { Location: settings.iconUrl, "Cache-Control": "public, max-age=21600" } });
        const icon = await asset(env, "/_meowcord/icon.png", url);
        return new Response(icon.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=21600" } });
    }
    if (path === "/static/wordmark") {
        if (settings.logoUrl) return new Response(null, { status: 302, headers: { Location: settings.logoUrl, "Cache-Control": "public, max-age=21600" } });
        return new Response("not found", { status: 404 });
    }

    const file = /^\/assets\/([\w.-]+)$/.exec(path)?.[1];
    const branded = file && BRANDED_CLIENT_ASSETS[file];
    if (branded) {
        if (branded.wordmark && settings.logoUrl) return new Response(null, { status: 302, headers: { Location: (await brandImageUrls(settings)).logo ?? "/", ...NO_CACHE } });
        return new Response(branded.svg(settings.instanceName, await iconDataUri(settings)), { headers: { "Content-Type": "image/svg+xml", ...NO_CACHE } });
    }
    if (path.startsWith("/e2ee/attachments/")) return new Response("This content is no longer available.", { status: 404, headers: { "Content-Type": "text/plain" } });
    if (path.startsWith("/assets/") || path.startsWith("/vendor/")) {
        const version = /^\/assets\/version\.[\w-]+\.json$/.test(path);
        if (!version) return new Response("Not Found", { status: 404, headers: NO_CACHE });
        const client = await loadBundle(env, url);
        return Response.json({ hash: client?.versionHash ?? null, required: false }, { headers: NO_CACHE });
    }

    const gift = /^\/gift\/([^/]+)$/.exec(path);
    if (gift) return new Response(null, { status: 302, headers: { Location: `/gifts/${encodeURIComponent(decodeURIComponent(gift[1]))}` } });

    const pageName = PAGES[path.replace(/\/+$/, "")];
    if (pageName) {
        const page = await brandPage(env, url, pageName, settings);
        if (page) return html(page, 200, pageName === "appeal" ? { "Referrer-Policy": "no-referrer" } : {});
    }
    if (path === "/developers" || path.startsWith("/developers/")) {
        if (/^\/developers\/docs(\/|$)/.test(path)) return Response.redirect("https://docs.discord.food/", 302);
        const page = await asset(env, "/_meowcord/pages/developers.html", url);
        const config = JSON.stringify({
            instanceName: settings.instanceName,
            icon: (await brandImageUrls(settings)).icon ?? "/static/logo.png",
            cdn: settings.cdnEndpoint?.replace(/\/+$/, "") ?? "",
            activityHost: (settings.activityApplicationHost ?? "").replace(/^(https?:)?\/\//, "").replace(/\/.*$/, ""),
        }).replace(/</g, "\\u003c");
        return html((await page.text()).replace("{{CONFIG}}", () => config).replace("{{TITLE}}", () => `${settings.instanceName.replace(/[<>&"]/g, "")} Developer Portal`));
    }

    const client = await loadBundle(env, url);
    if (!client)
        return html(
            "<!doctype html><title>Client missing</title><p>The web client was not uploaded with this deployment. Run scripts/workers/prepare-assets.mjs before deploying.</p>",
            503,
        );
    const root = path.split("/")[1].toLowerCase();
    if (client.roots && !client.roots.includes(root)) {
        const notFound = await brandPage(env, url, "not-found", settings);
        return html(notFound ?? "Not Found", 404);
    }
    const page = await renderClient(client, settings);
    if (request.headers.get("if-none-match") === page.etag) return new Response(null, { status: 304, headers: { ETag: page.etag, ...NO_CACHE } });
    return html(request.method === "HEAD" ? "" : page.html, 200, { ETag: page.etag });
};
