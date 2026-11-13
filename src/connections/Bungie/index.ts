import { ConnectedAccount } from "@spacebar/database";
import { Connection, ConnectionLoader } from "@spacebar/util";
import { ConnectionCallbackSchema } from "@spacebar/schemas";
import { providerFailure, providerJson } from "../ProviderRequest";

export class BungieSettings {
    enabled: boolean = false;
    clientId: string | null = null;
    clientSecret: string | null = null;
    apiKey: string | null = null;
}

interface BungieToken {
    access_token: string;
    membership_id: string;
}

interface BungieUser {
    membershipId: string;
    uniqueName?: string;
    displayName?: string;
    cachedBungieGlobalDisplayName?: string;
    cachedBungieGlobalDisplayNameCode?: number;
}

interface BungieMemberships {
    ErrorCode: number;
    Response?: { bungieNetUser?: BungieUser };
}

export function bungieDisplayName(user: BungieUser) {
    if (user.cachedBungieGlobalDisplayName && user.cachedBungieGlobalDisplayNameCode != null)
        return `${user.cachedBungieGlobalDisplayName}#${String(user.cachedBungieGlobalDisplayNameCode).padStart(4, "0")}`;
    return user.uniqueName || user.displayName || user.membershipId;
}

export default class BungieConnection extends Connection {
    public readonly id = "bungie";
    public readonly friendlyName = "Bungie.net";
    public readonly setupUrl = "https://www.bungie.net/en/Application";
    public readonly requiredScopes: string[] = [];

    public readonly authorizeUrl = "https://www.bungie.net/en/OAuth/Authorize";
    public readonly tokenUrl = "https://www.bungie.net/Platform/App/OAuth/token/";
    public readonly userInfoUrl = "https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/";
    settings: BungieSettings = new BungieSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<BungieSettings>(this.id, this.settings);
    }

    get requiredSettings(): string[] {
        return ["clientId", "clientSecret", "apiKey"];
    }

    public get isConfigured(): boolean {
        return !!this.settings.clientId && !!this.settings.clientSecret && !!this.settings.apiKey;
    }

    getAuthorizationUrl(userId: string): string {
        const url = new URL(this.authorizeUrl);
        url.searchParams.set("client_id", this.settings.clientId as string);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("state", this.createState(userId));
        return url.toString();
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { userId } = this.validateState(params.state);
        if (!params.code) throw providerFailure(this.friendlyName, "the sign in was cancelled.");

        const credentials = Buffer.from(`${this.settings.clientId}:${this.settings.clientSecret}`).toString("base64");
        const token = await providerJson<BungieToken>(this.friendlyName, this.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${credentials}`, "X-API-Key": this.settings.apiKey as string },
            body: new URLSearchParams({ grant_type: "authorization_code", code: params.code }).toString(),
        });
        const memberships = await providerJson<BungieMemberships>(this.friendlyName, this.userInfoUrl, {
            headers: { Authorization: `Bearer ${token.access_token}`, "X-API-Key": this.settings.apiKey as string },
        });
        const user = memberships.Response?.bungieNetUser;
        if (memberships.ErrorCode !== 1 || !user || String(user.membershipId) !== String(token.membership_id))
            throw providerFailure(this.friendlyName, "the account details were incomplete.");

        const externalId = String(user.membershipId);
        if (await this.hasConnection(userId, externalId)) return null;

        return await this.createConnection({
            user_id: userId,
            external_id: externalId,
            friend_sync: params.friend_sync,
            name: bungieDisplayName(user).slice(0, 100),
            type: this.id,
        });
    }
}
