import { APP_THEME_COLOR } from "../util/util/BrandMarkup";
import { CUSTOM_CLAN_BADGE_PACK, CUSTOM_CLAN_BADGES, clanBadgeColorCount, clanBadgePack } from "../util/util/ClanBadges";

export const GLOBAL_ENV_SCRIPT = /<script[^>]*>\s*window\.GLOBAL_ENV\s*=([\s\S]*?)<\/script>/;

export const CLIENT_INJECT_MARKER = "<!-- meowcord:client-inject -->";

export const ENDPOINT_KEYS = [
    "API_ENDPOINT",
    "API_PROTOCOL",
    "GATEWAY_ENDPOINT",
    "GATEWAY_ALT_ENDPOINT",
    "ASSET_ENDPOINT",
    "MEDIA_PROXY_ENDPOINT",
    "IMAGE_PROXY_ENDPOINTS",
    "CDN_HOST",
    "DEVELOPERS_ENDPOINT",
    "MARKETING_ENDPOINT",
    "WEBAPP_ENDPOINT",
    "WIDGET_ENDPOINT",
    "INVITE_HOST",
    "GUILD_TEMPLATE_HOST",
    "GIFT_CODE_HOST",
    "PRIMARY_DOMAIN",
    "REMOTE_AUTH_ENDPOINT",
    "RTC_LATENCY_ENDPOINT",
    "MIGRATION_SOURCE_ORIGIN",
    "MIGRATION_DESTINATION_ORIGIN",
    "ACTIVITY_APPLICATION_HOST",
];

export const EXTRA_CLIENT_ROOTS = ["", "ra"];

export interface ClientJoinReason {
    required: boolean;
    minLength: number;
    maxLength: number;
    approval: boolean;
}

export interface ClientEnvSettings {
    instanceName: string;
    instanceId: string | null;
    activityApplicationHost: string | null;
    loadingTips: string[] | null;
    loadingSvg: string | null;
    icon: string | null;
    logo: string | null;
    helpUrl: string | null;
    allowSlowmodeBypass: boolean;
    e2eeTrustServer: boolean;
    maxGroupDmRecipients: number;
    emailRequired: boolean;
    joinReason: ClientJoinReason | null;
}

export const baseGlobalEnv = (parsed: Record<string, unknown>) => Object.fromEntries(Object.entries(parsed).filter(([key]) => !ENDPOINT_KEYS.includes(key)));

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export const clientEnvScript = (base: Record<string, unknown>, settings: ClientEnvSettings) => `<script>
(() => {
    const host = location.host;
    const secure = location.protocol === "https:";
    const cdn = host;
    const gateway = \`\${secure ? "wss" : "ws"}://\${host}\`;
    window.GLOBAL_ENV = Object.assign(${JSON.stringify(base)}, {
        HTML_TIMESTAMP: Date.now(),
        API_ENDPOINT: \`//\${host}/api\`,
        API_PROTOCOL: location.protocol,
        GATEWAY_ENDPOINT: gateway,
        GATEWAY_ALT_ENDPOINT: gateway,
        ASSET_ENDPOINT: \`//\${host}\`,
        MEDIA_PROXY_ENDPOINT: \`//\${cdn}\`,
        IMAGE_PROXY_ENDPOINTS: \`//\${host}\`,
        CDN_HOST: cdn,
        DEVELOPERS_ENDPOINT: \`//\${host}\`,
        MARKETING_ENDPOINT: \`//\${host}\`,
        WEBAPP_ENDPOINT: \`//\${host}\`,
        WIDGET_ENDPOINT: \`//\${host}/widget\`,
        INVITE_HOST: \`\${host}/invite\`,
        GUILD_TEMPLATE_HOST: \`\${host}/template\`,
        GIFT_CODE_HOST: \`\${host}/gift\`,
        PRIMARY_DOMAIN: host,
        REMOTE_AUTH_ENDPOINT: \`\${secure ? "wss" : "ws"}://\${host}/remote-auth\`,
        RTC_LATENCY_ENDPOINT: \`//\${host}/rtc\`,
        MIGRATION_SOURCE_ORIGIN: location.origin,
        MIGRATION_DESTINATION_ORIGIN: location.origin,
        WEBAUTHN_ORIGIN: location.hostname,
        ACTIVITY_APPLICATION_HOST: ${json(settings.activityApplicationHost ?? "")} || \`//\${host}\`,
        LOADING_TIPS: ${json(settings.loadingTips)},
        LOADING_SVG: ${json(settings.loadingSvg)},
        INSTANCE_NAME: ${json(settings.instanceName)},
        INSTANCE_ID: ${json(settings.instanceId)},
        INSTANCE_ICON: ${json(settings.icon)},
        INSTANCE_LOGO: ${json(settings.logo)},
        HELP_URL: ${json(settings.helpUrl)},
        SLOWMODE_ALLOW_BYPASS: ${json(settings.allowSlowmodeBypass === true)},
        E2EE_TRUST_SERVER: ${json(settings.e2eeTrustServer !== false)},
        PRIVATE_ENCRYPTION_DEFAULT: true,
        GROUP_DM_RECIPIENT_LIMIT: ${json(settings.maxGroupDmRecipients)},
        REGISTER_EMAIL_REQUIRED: ${json(settings.emailRequired === true)},
        REGISTER_JOIN_REASON: ${json(settings.joinReason)},
        CUSTOM_CLAN_BADGE_PACK: ${json(CUSTOM_CLAN_BADGE_PACK)},
        CUSTOM_CLAN_BADGES: ${json(CUSTOM_CLAN_BADGES.map((badge) => ({ ...badge, pack: clanBadgePack(badge), colors: clanBadgeColorCount(badge) })))},
    });
})();
</script>`;

export const prepareClientHtml = (source: string) =>
    source
        .replace(GLOBAL_ENV_SCRIPT, () => CLIENT_INJECT_MARKER)
        .replace(/<script[^>]*>[^<]*__CF\$cv\$params[\s\S]*?<\/script>/, "")
        .replace(/<script[^>]*src="\/assets\/sentry\.[0-9a-f]+\.js"[^>]*><\/script>\s*/g, "")
        .replace(/<link[^>]*href="\/assets\/sentry\.[0-9a-f]+\.js"[^>]*>\s*/g, "")
        .replace(/ nonce="[^"]*"/g, "")
        .replace(/<link rel="preconnect"[^>]*>\s*/g, "")
        .replace(/<!-- section:seometa -->[\s\S]*?<!-- endsection -->/, "")
        .replace(
            /<meta content="[^"]*" name="viewport">/,
            '<meta content="width=device-width, initial-scale=1, maximum-scale=3, interactive-widget=resizes-content" name="viewport">',
        )
        .replace(/<link[^>]*rel="(?:shortcut )?icon"[^>]*>/g, "")
        .replace(
            "</body>",
            `<footer id="meowcord-credit" hidden>this instance is running <a href="https://github.com/meowcorded/meowcord">meowcord</a>!</footer><script src="/assets/meowcord-credit.js"></script></body>`,
        );

export const escapeTitle = (name: string) => name.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

export const appMetaTags = (title: string, appleTouchIcon: string) =>
    [
        `<link rel="icon" href="/favicon.svg">`,
        `<link rel="manifest" href="/manifest.webmanifest">`,
        `<meta name="theme-color" content="${APP_THEME_COLOR}">`,
        `<meta name="mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-status-bar-style" content="black">`,
        `<meta name="apple-mobile-web-app-title" content="${title}">`,
        `<link rel="apple-touch-icon" href="${appleTouchIcon}">`,
    ].join("\n    ");

export const finishClientHtml = (prepared: string, inject: string, title: string, appMeta: string) =>
    prepared.replace(CLIENT_INJECT_MARKER, () => inject).replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>\n    ${appMeta}`);

export const vencordScriptTag = (hash: string | null) => (hash ? `<script src="/assets/vencord/vencord.js?v=${hash}"></script>` : "");

export const clientRootsFromEntry = (source: string) => {
    const start = source.indexOf('Object.freeze({INDEX:"/",');
    if (start === -1) return null;
    let depth = 0;
    let end = start;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && !--depth) {
            end = i;
            break;
        }
    }
    const roots = new Set(EXTRA_CLIENT_ROOTS);
    for (const [, root] of source.slice(start, end).matchAll(/[`"]\/([\w@.-]*)/g)) roots.add(root.toLowerCase());
    return roots.size > EXTRA_CLIENT_ROOTS.length ? roots : null;
};
