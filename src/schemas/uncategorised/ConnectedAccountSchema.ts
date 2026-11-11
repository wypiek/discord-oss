export interface ConnectedAccountSchema {
    external_id: string;
    user_id: string;
    token_data?: ConnectedAccountTokenData;
    friend_sync?: boolean;
    name: string;
    revoked?: boolean;
    show_activity?: number;
    type: string;
    verified?: boolean;
    visibility?: number;
    integrations?: string[];
    metadata_?: unknown;
    metadata_visibility?: number;
    two_way_link?: boolean;
}

export interface ConnectedAccountCommonOAuthTokenResponse {
    access_token: string;
    token_type: string;
    scope: string;
    refresh_token?: string;
    expires_in?: number;
}

export interface ConnectedAccountTokenData {
    access_token: string;
    token_type?: string;
    scope?: string;
    refresh_token?: string;
    expires_in?: number;
    expires_at?: number;
    fetched_at: number;
}
