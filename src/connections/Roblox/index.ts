import { ConnectedAccount } from "@spacebar/database";
import { Connection, ConnectionLoader } from "@spacebar/util";
import { ConnectedAccountCommonOAuthTokenResponse, ConnectionCallbackSchema } from "@spacebar/schemas";
import { GenericOAuthSettings as RobloxSettings } from "../GenericOAuthSettings";
import { providerFailure, providerJson } from "../ProviderRequest";

interface RobloxUserInfo {
    sub: string;
    name?: string;
    nickname?: string;
    preferred_username?: string;
}

export default class RobloxConnection extends Connection {
    public readonly id = "roblox";
    public readonly friendlyName = "Roblox";
    public readonly setupUrl = "https://create.roblox.com/dashboard/credentials";
    public readonly requiredScopes = ["openid", "profile"];

    public readonly authorizeUrl = "https://apis.roblox.com/oauth/v1/authorize";
    public readonly tokenUrl = "https://apis.roblox.com/oauth/v1/token";
    public readonly userInfoUrl = "https://apis.roblox.com/oauth/v1/userinfo";
    settings: RobloxSettings = new RobloxSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<RobloxSettings>(this.id, this.settings);
    }

    public get isConfigured(): boolean {
        return !!this.settings.clientId && !!this.settings.clientSecret;
    }

    getAuthorizationUrl(userId: string): string {
        const url = new URL(this.authorizeUrl);
        url.searchParams.set("client_id", this.settings.clientId as string);
        url.searchParams.set("redirect_uri", this.getRedirectUri());
        url.searchParams.set("scope", this.requiredScopes.join(" "));
        url.searchParams.set("response_type", "code");
        url.searchParams.set("state", this.createState(userId));
        return url.toString();
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { userId } = this.validateState(params.state);
        if (!params.code) throw providerFailure(this.friendlyName, "the sign in was cancelled.");

        const token = await providerJson<ConnectedAccountCommonOAuthTokenResponse>(this.friendlyName, this.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: params.code,
                client_id: this.settings.clientId as string,
                client_secret: this.settings.clientSecret as string,
            }).toString(),
        });
        const user = await providerJson<RobloxUserInfo>(this.friendlyName, this.userInfoUrl, { headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!/^\d+$/.test(user.sub ?? "")) throw providerFailure(this.friendlyName, "the account details were incomplete.");

        if (await this.hasConnection(userId, user.sub)) return null;

        return await this.createConnection({
            user_id: userId,
            external_id: user.sub,
            friend_sync: params.friend_sync,
            name: (user.preferred_username || user.nickname || user.name || user.sub).slice(0, 100),
            type: this.id,
        });
    }
}
