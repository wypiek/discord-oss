import wretch from "wretch";
import { ConnectedAccount } from "@spacebar/database";
import { Connection, ConnectionLoader, DiscordApiErrors } from "@spacebar/util";
import { ConnectedAccountCommonOAuthTokenResponse, ConnectionCallbackSchema } from "@spacebar/schemas";
import { GenericOAuthSettings as GitHubSettings } from "../GenericOAuthSettings";

const githubUserAgent = "instance-connections";
const githubErrorCode = (error: unknown) => (typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "no access token");

interface UserResponse {
    login: string;
    id: number;
    name: string;
}

export default class GitHubConnection extends Connection {
    public readonly id = "github";
    public friendlyName = "GitHub";
    public setupUrl = "https://github.com/settings/developers";
    public requiredScopes: string[];

    public readonly authorizeUrl = "https://github.com/login/oauth/authorize";
    public readonly tokenUrl = "https://github.com/login/oauth/access_token";
    public readonly userInfoUrl = "https://api.github.com/user";
    public readonly scopes = ["read:user"];
    settings: GitHubSettings = new GitHubSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<GitHubSettings>(this.id, this.settings);

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
        url.searchParams.append("scope", this.scopes.join(" "));
        url.searchParams.append("state", state);
        return url.toString();
    }

    getTokenUrl(): string {
        return this.tokenUrl;
    }

    async exchangeCode(state: string, code: string): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        this.validateState(state);

        const response = await wretch(this.getTokenUrl())
            .headers({
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": githubUserAgent,
            })
            .body(
                new URLSearchParams({
                    client_id: this.settings.clientId as string,
                    client_secret: this.settings.clientSecret as string,
                    code,
                    redirect_uri: this.getRedirectUri(),
                }),
            )
            .post()
            .json<Partial<ConnectedAccountCommonOAuthTokenResponse> & { error?: string }>()
            .catch((error) => {
                console.error(`[GitHub connection] token exchange failed with status ${error?.status ?? "unknown"}`);
                throw DiscordApiErrors.GENERAL_ERROR;
            });

        if (!response.access_token) {
            console.error(`[GitHub connection] token exchange refused: ${githubErrorCode(response.error)}`);
            throw DiscordApiErrors.GENERAL_ERROR;
        }
        return response as ConnectedAccountCommonOAuthTokenResponse;
    }

    async getUser(token: string): Promise<UserResponse> {
        return wretch(this.userInfoUrl)
            .headers({
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "User-Agent": githubUserAgent,
                "X-GitHub-Api-Version": "2022-11-28",
            })
            .get()
            .json<UserResponse>()
            .catch((error) => {
                console.error(`[GitHub connection] user lookup failed with status ${error?.status ?? "unknown"}`);
                throw DiscordApiErrors.GENERAL_ERROR;
            });
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { state, code } = params;
        if (!code) throw new Error("No code provided");

        const userId = this.getUserId(state);
        const tokenData = await this.exchangeCode(state, code);
        const userInfo = await this.getUser(tokenData.access_token);

        const exists = await this.hasConnection(userId, userInfo.id.toString());

        if (exists) return null;

        return await this.createConnection({
            user_id: userId,
            external_id: userInfo.id.toString(),
            friend_sync: params.friend_sync,
            name: userInfo.login,
            type: this.id,
        });
    }
}
