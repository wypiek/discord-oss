import wretch from "wretch";
import { ConnectedAccount } from "@spacebar/database";
import { ConnectionLoader, DiscordApiErrors, RefreshableConnection } from "@spacebar/util";
import { ConnectedAccountCommonOAuthTokenResponse, ConnectionCallbackSchema } from "@spacebar/schemas";
import { GenericOAuthSettings as SpotifySettings } from "../GenericOAuthSettings";

export interface UserResponse {
    display_name: string;
    id: string;
}

export interface TokenErrorResponse {
    error: string;
    error_description: string;
}

export interface ErrorResponse {
    error: {
        status: number;
        message: string;
    };
}

export default class SpotifyConnection extends RefreshableConnection {
    public readonly id = "spotify";
    public friendlyName = "Spotify";
    public setupUrl = "https://developer.spotify.com";
    public readonly scopes = ["user-read-private", "user-read-playback-state", "user-read-currently-playing", "user-modify-playback-state"];
    public requiredScopes = this.scopes;

    public readonly authorizeUrl = "https://accounts.spotify.com/authorize";
    public readonly tokenUrl = "https://accounts.spotify.com/api/token";
    public readonly userInfoUrl = "https://api.spotify.com/v1/me";
    settings: SpotifySettings = new SpotifySettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<SpotifySettings>(this.id, this.settings);

        if (this.settings.enabled && (!this.settings.clientId || !this.settings.clientSecret)) throw new Error(`Invalid settings for connection ${this.id}`);
    }

    public get isConfigured(): boolean {
        return !!this.settings.clientId && !!this.settings.clientSecret;
    }

    getAuthorizationUrl(userId: string): string {
        const state = this.createState(userId);
        const url = new URL(this.authorizeUrl);

        url.searchParams.append("client_id", this.settings.clientId as string);
        url.searchParams.append("redirect_uri", this.getRedirectUri());
        url.searchParams.append("response_type", "code");
        url.searchParams.append("scope", this.scopes.join(" "));
        url.searchParams.append("state", state);
        return url.toString();
    }

    getTokenUrl(): string {
        return this.tokenUrl;
    }

    async exchangeCode(state: string, code: string): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        this.validateState(state);

        const url = this.getTokenUrl();

        return wretch(url.toString())
            .headers({
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${this.settings.clientId as string}:${this.settings.clientSecret as string}`).toString("base64")}`,
            })
            .body(
                new URLSearchParams({
                    grant_type: "authorization_code",
                    code: code,
                    redirect_uri: this.getRedirectUri(),
                }),
            )
            .post()
            .json<ConnectedAccountCommonOAuthTokenResponse>()
            .catch((e) => {
                console.error(`[Connections/${this.id}] code exchange failed with status ${e?.status}`);
                throw DiscordApiErrors.GENERAL_ERROR;
            });
    }

    async refreshToken(connectedAccount: ConnectedAccount): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        const refresh_token = connectedAccount.token_data?.refresh_token;
        if (!refresh_token) throw DiscordApiErrors.CONNECTION_REVOKED;

        const response = await fetch(this.getTokenUrl(), {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${this.settings.clientId as string}:${this.settings.clientSecret as string}`).toString("base64")}`,
            },
            body: new URLSearchParams({ grant_type: "refresh_token", refresh_token }),
            signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        if (!response) throw DiscordApiErrors.GENERAL_ERROR;
        if (response.ok) return (await response.json()) as ConnectedAccountCommonOAuthTokenResponse;

        const error = (await response.json().catch(() => null)) as TokenErrorResponse | null;
        if (error?.error === "invalid_grant") {
            await ConnectedAccount.update({ user_id: connectedAccount.user_id, external_id: connectedAccount.external_id, type: this.id }, { revoked: true, token_data: null });
            throw DiscordApiErrors.CONNECTION_REVOKED;
        }
        console.error(`[Connections/${this.id}] token refresh failed with status ${response.status}${error?.error ? ` (${error.error})` : ""}`);
        throw DiscordApiErrors.GENERAL_ERROR;
    }

    async getUser(token: string): Promise<UserResponse> {
        const url = new URL(this.userInfoUrl);

        return wretch(url.toString())
            .headers({
                Authorization: `Bearer ${token}`,
            })
            .get()
            .json<UserResponse>()
            .catch((e) => {
                console.error(`[Connections/${this.id}] user lookup failed with status ${e?.status}`);
                throw DiscordApiErrors.GENERAL_ERROR;
            });
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { state, code } = params;
        if (!code) throw new Error("No code provided");

        const userId = this.getUserId(state);
        const tokenData = await this.exchangeCode(state, code);
        const userInfo = await this.getUser(tokenData.access_token);

        const token_data = { ...tokenData, fetched_at: Date.now() };

        if (await this.hasConnection(userId, userInfo.id)) {
            await ConnectedAccount.update({ user_id: userId, external_id: userInfo.id, type: this.id }, { token_data, revoked: false, name: userInfo.display_name });
            return null;
        }

        return await this.createConnection({
            token_data,
            user_id: userId,
            external_id: userInfo.id,
            friend_sync: params.friend_sync,
            name: userInfo.display_name,
            type: this.id,
            show_activity: 1,
            visibility: 1,
        });
    }
}
