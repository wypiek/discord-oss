export interface SpacebarWellKnownLegacyResponse {
    api: string;
}

export interface SpacebarWellKnownClientResponse {
    api: {
        baseUrl: string;
        apiVersions: {
            default: string;
            active: string[];
        };
    };
    cdn: {
        baseUrl: string;
    };
    gateway: {
        baseUrl: string;
        encoding: string[];
        compression: (string | null)[];
    };
    admin?: {
        baseUrl: string;
    };
}

export interface DiscordOssWellKnownResponse {
    software: {
        name: "discord-oss";
        version: string;
    };
    protocol: number;
    instance: {
        id: string;
        name: string;
        description: string;
        url: string;
        icon: string;
        logo: string | null;
        theme_color: string;
        contact_email: string | null;
    };
    api: {
        url: string;
        default_version: string;
        versions: string[];
    };
    gateway: {
        url: string;
        encodings: string[];
        compression: string[];
    };
    cdn: {
        url: string;
    };
    voice: {
        dave: boolean;
        regions: { id: string; name: string; endpoint: string; default: boolean }[];
    };
    registration: {
        open: boolean;
        invite_required: boolean;
        approval_required: boolean;
        email_required: boolean;
        minimum_age: number;
        join_reason: { required: boolean; min_length: number; max_length: number } | null;
        captcha: { service: "cap"; sitekey: string; endpoint: string } | null;
    };
    e2ee: {
        protocol: number;
        direct_messages: boolean;
    };
    links: {
        status: string;
        support: string;
        blog: string;
        terms: string;
        privacy: string;
        guidelines: string;
        developers: string;
    };
}
