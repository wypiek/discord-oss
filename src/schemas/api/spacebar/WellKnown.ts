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
