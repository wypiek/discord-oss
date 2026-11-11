import { DiscordOssWellKnownResponse } from "@spacebar/schemas";
import { ConfigValue } from "@spacebar/util";

export const INSTANCE_DISCOVERY_PROTOCOL = 1;
export const E2EE_PROTOCOL = 1;

export type InstanceDiscoveryInput = {
    config: Pick<ConfigValue, "api" | "cdn" | "gateway" | "general" | "register" | "regions">;
    origin: string;
    name: string;
    description: string;
    iconPath: string;
    logoPath: string | null;
    themeColor: string;
    version: string;
    supportUrl: string | null;
    captcha: { endpoint: string; sitekey: string } | null;
};

const absolute = (value: string, origin: string) => new URL(value, `${origin}/`).href;

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const configuredOrigin = (value: string | null | undefined) => (value && URL.canParse(value) ? withoutTrailingSlash(value) : null);

export function buildInstanceDiscovery(input: InstanceDiscoveryInput): DiscordOssWellKnownResponse {
    const { config, origin } = input;
    const register = config.register;
    const gatewayUrl = configuredOrigin(config.gateway.endpointPublic) ?? origin.replace(/^http/, "ws");
    const apiBase = configuredOrigin(config.api.endpointPublic?.replace(/\/+$/, "").replace(/\/api(\/v\d+)?$/, "")) ?? origin;
    const cdnUrl = configuredOrigin(config.cdn.endpointPublic) ?? origin;
    return {
        software: { name: "discord-oss", version: input.version },
        protocol: INSTANCE_DISCOVERY_PROTOCOL,
        instance: {
            id: config.general.instanceId,
            name: input.name,
            description: input.description,
            url: origin,
            icon: absolute(input.iconPath, origin),
            logo: input.logoPath ? absolute(input.logoPath, origin) : null,
            theme_color: input.themeColor,
            contact_email: config.general.correspondenceEmail?.trim() || null,
        },
        api: {
            url: `${apiBase}/api`,
            default_version: config.api.defaultVersion,
            versions: [...config.api.activeVersions],
        },
        gateway: {
            url: gatewayUrl,
            encodings: ["json", "etf"],
            compression: ["zlib-stream", "zstd-stream"],
        },
        cdn: { url: cdnUrl },
        voice: {
            dave: true,
            regions: config.regions.available
                .filter((region) => !region.deprecated)
                .map((region) => ({ id: region.id, name: region.name, endpoint: region.endpoint, default: region.id === config.regions.default })),
        },
        registration: {
            open: register.allowNewRegistration && !register.disabled,
            invite_required: register.requireInvite,
            approval_required: register.requireApproval,
            email_required: register.email.required,
            minimum_age: register.dateOfBirth.minimum,
            join_reason: register.joinReason.required ? { required: true, min_length: register.joinReason.minLength, max_length: register.joinReason.maxLength } : null,
            captcha: register.requireCaptcha && input.captcha ? { service: "cap", sitekey: input.captcha.sitekey, endpoint: absolute(input.captcha.endpoint, origin) } : null,
        },
        e2ee: { protocol: E2EE_PROTOCOL, direct_messages: true },
        links: {
            status: `${origin}/status`,
            support: input.supportUrl ?? `${origin}/support`,
            blog: `${origin}/blog`,
            terms: `${origin}/terms`,
            privacy: `${origin}/privacy`,
            guidelines: `${origin}/guidelines`,
            developers: `${origin}/developers`,
        },
    };
}
