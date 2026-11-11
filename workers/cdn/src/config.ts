import type { CdnEnv } from "./env";

export interface InstanceConfig {
    general?: { instanceName?: string; image?: string | null; serverName?: string | null };
    api?: { endpointPublic?: string | null };
    cdn?: { endpointPublic?: string | null };
    client?: {
        instanceName?: string;
        icon?: string | null;
        logo?: string | null;
        helpUrl?: string | null;
        activityApplicationHost?: string | null;
        loadingTips?: string[] | null;
        loadingSvg?: string | null;
    };
    limits?: {
        channel?: { allowSlowmodeBypass?: boolean; maxGroupDmRecipients?: number };
        e2ee?: { trustServerByDefault?: boolean };
    };
    register?: {
        email?: { required?: boolean };
        joinReason?: { required?: boolean; minLength?: number; maxLength?: number };
        requireApproval?: boolean;
    };
    security?: {
        requestSignature?: string;
        cdnSignUrls?: boolean;
        cdnSignatureKey?: string;
        cdnSignatureIncludeIp?: boolean;
        cdnSignatureIncludeUserAgent?: boolean;
    };
    externalRequests?: { discordAssetFallback?: boolean };
}

let parsed: { source: string; value: InstanceConfig } | null = null;

export const instanceConfig = (env: CdnEnv): InstanceConfig => {
    const source = env.CONFIG_JSON ?? "";
    if (parsed?.source === source) return parsed.value;
    let value: InstanceConfig = {};
    try {
        value = source ? JSON.parse(source) : {};
    } catch {
        console.warn("[cdn] CONFIG_JSON is not valid JSON, ignoring it");
    }
    parsed = { source, value };
    return value;
};

const flag = (value: string | undefined, fallback: boolean | undefined) => (value === "true" ? true : value === "false" ? false : fallback);

export const cdnSettings = (env: CdnEnv) => {
    const { security, cdn, externalRequests } = instanceConfig(env);
    return {
        requestSignature: env.REQUEST_SIGNATURE || security?.requestSignature || null,
        signatureKey: env.CDN_SIGNATURE_KEY || security?.cdnSignatureKey || null,
        signUrls: flag(env.CDN_SIGN_URLS, security?.cdnSignUrls) ?? false,
        includeIp: flag(env.CDN_SIGNATURE_INCLUDE_IP, security?.cdnSignatureIncludeIp) ?? true,
        includeUserAgent: flag(env.CDN_SIGNATURE_INCLUDE_USER_AGENT, security?.cdnSignatureIncludeUserAgent) ?? true,
        endpointPublic: env.CDN_ENDPOINT_PUBLIC || cdn?.endpointPublic || null,
        upstream: flag(env.CDN_UPSTREAM, externalRequests?.discordAssetFallback) ?? true,
    };
};
