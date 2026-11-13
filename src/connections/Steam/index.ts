import { ConnectedAccount } from "@spacebar/database";
import { Connection, ConnectionLoader, publicWebOrigin } from "@spacebar/util";
import { ConnectionCallbackSchema } from "@spacebar/schemas";
import { providerFailure, providerFetch, providerJson } from "../ProviderRequest";
import { STEAM_OPENID_ENDPOINT, checkAuthenticationBody, isValidCheckAuthenticationResponse, personaNameFromProfileXml, steamIdFromAssertion, steamLoginUrl } from "./openid";

export class SteamSettings {
    enabled: boolean = true;
    apiKey: string | null = null;
}

interface PlayerSummaries {
    response?: { players?: { steamid: string; personaname?: string }[] };
}

export default class SteamConnection extends Connection {
    public readonly id = "steam";
    public readonly friendlyName = "Steam";
    public readonly setupUrl = "https://steamcommunity.com/dev/apikey";
    public readonly requiredScopes: string[] = [];
    settings: SteamSettings = new SteamSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<SteamSettings>(this.id, this.settings);
    }

    public get isConfigured(): boolean {
        return !!publicWebOrigin();
    }

    getAuthorizationUrl(userId: string): string {
        const returnTo = new URL(this.getRedirectUri());
        returnTo.searchParams.set("state", this.createState(userId));
        return steamLoginUrl(returnTo.toString(), publicWebOrigin());
    }

    async personaName(steamId: string): Promise<string> {
        if (this.settings.apiKey) {
            const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
            url.searchParams.set("key", this.settings.apiKey);
            url.searchParams.set("steamids", steamId);
            const summaries = await providerJson<PlayerSummaries>(this.friendlyName, url.toString()).catch(() => null);
            const name = summaries?.response?.players?.find((player) => player.steamid === steamId)?.personaname?.trim();
            if (name) return name.slice(0, 100);
        }
        const profile = await providerFetch(this.friendlyName, `https://steamcommunity.com/profiles/${steamId}/?xml=1`)
            .then((res) => res.text())
            .catch(() => "");
        return personaNameFromProfileXml(profile) ?? steamId;
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { userId } = this.validateState(params.state);
        const steamId = steamIdFromAssertion(params.openid_params, this.getRedirectUri(), params.state);
        if (!steamId) throw providerFailure(this.friendlyName, "the sign in response was incomplete or expired. Try connecting again.");

        const check = await providerFetch(this.friendlyName, STEAM_OPENID_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: checkAuthenticationBody(params.openid_params ?? {}).toString(),
        });
        if (!isValidCheckAuthenticationResponse(await check.text())) throw providerFailure(this.friendlyName, "the sign in wasn't confirmed. Try connecting again.");

        if (await this.hasConnection(userId, steamId)) return null;

        return await this.createConnection({
            user_id: userId,
            external_id: steamId,
            friend_sync: params.friend_sync,
            name: await this.personaName(steamId),
            type: this.id,
        });
    }
}
