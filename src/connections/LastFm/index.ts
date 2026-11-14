import { ConnectedAccount } from "@spacebar/database";
import { Connection, ConnectionLoader, LASTFM_API, lastFmSignature, lastFmUserAgent } from "@spacebar/util";
import { ConnectionCallbackSchema } from "@spacebar/schemas";
import { providerFailure, providerJson } from "../ProviderRequest";

class LastFmSettings {
    enabled: boolean = false;
    apiKey: string | null = null;
    sharedSecret: string | null = null;
}

interface SessionResponse {
    session?: { name?: unknown; key?: unknown };
    error?: number;
}

export default class LastFmConnection extends Connection {
    public readonly id = "lastfm";
    public readonly friendlyName = "Last.fm";
    public readonly setupUrl = "https://www.last.fm/api/account/create";
    public readonly requiredScopes: string[] = [];
    public readonly authorizeUrl = "https://www.last.fm/api/auth/";
    settings: LastFmSettings = new LastFmSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<LastFmSettings>(this.id, this.settings);
    }

    get requiredSettings(): string[] {
        return ["apiKey", "sharedSecret"];
    }

    public get isConfigured(): boolean {
        return !!this.settings.apiKey && !!this.settings.sharedSecret;
    }

    getAuthorizationUrl(userId: string): string {
        const callback = new URL(this.getRedirectUri());
        callback.searchParams.set("state", this.createState(userId));
        const url = new URL(this.authorizeUrl);
        url.searchParams.set("api_key", this.settings.apiKey as string);
        url.searchParams.set("cb", callback.toString());
        return url.toString();
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { userId } = this.validateState(params.state);
        const token = params.code;
        if (!token || !/^[A-Za-z0-9_-]{1,128}$/.test(token)) throw providerFailure(this.friendlyName, "the sign in was cancelled.");

        const query: Record<string, string> = { method: "auth.getSession", api_key: this.settings.apiKey as string, token };
        query.api_sig = lastFmSignature(query, this.settings.sharedSecret as string);
        const response = await providerJson<SessionResponse>(this.friendlyName, `${LASTFM_API}?${new URLSearchParams({ ...query, format: "json" })}`, {
            headers: { "User-Agent": lastFmUserAgent },
        });
        const name = typeof response.session?.name === "string" ? response.session.name.trim() : "";
        if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
            console.warn(`[Last.fm connection] session request refused with error ${typeof response.error === "number" ? response.error : "unknown"}`);
            throw providerFailure(this.friendlyName, "the sign in couldn't be confirmed. Try again.");
        }

        if (await this.hasConnection(userId, name)) return null;

        return await this.createConnection({
            user_id: userId,
            external_id: name,
            friend_sync: params.friend_sync,
            name,
            type: this.id,
            show_activity: 1,
        });
    }
}
