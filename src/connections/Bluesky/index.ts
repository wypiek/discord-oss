import { Resolver } from "node:dns/promises";
import { KeyObject } from "node:crypto";
import { ConnectedAccount } from "@spacebar/database";
import { AuthorizationOptions, Config, Connection, ConnectionLoader, FieldErrors, fetchPublicUrl, publicWebOrigin } from "@spacebar/util";
import { ConnectionCallbackSchema } from "@spacebar/schemas";
import { providerFailure } from "../ProviderRequest";
import {
    AtprotoNetwork,
    authorizationServerFor,
    claimedHandle,
    createDpopKey,
    dpopPost,
    isAtprotoDid,
    normalizeHandle,
    pdsEndpoint,
    pkcePair,
    resolveDid,
    resolveHandle,
} from "./atproto";

export class BlueskySettings {
    enabled: boolean = true;
}

interface PendingLogin {
    verifier: string;
    key: KeyObject;
    issuer: string;
    tokenEndpoint: string;
    nonce?: string;
}

interface TokenResponse {
    access_token?: string;
    token_type?: string;
    sub?: string;
    scope?: string;
    error?: string;
}

const SCOPE = "atproto";
const resolver = new Resolver({ timeout: 4000, tries: 2 });

const network: AtprotoNetwork = {
    resolveTxt: (hostname) => resolver.resolveTxt(hostname),
    fetch: (url, init = {}) =>
        fetchPublicUrl(url, { ...init, redirect: "error" }, 0, { maxBytes: 256 * 1024, timeoutMs: 10_000, allowExternal: Config.get().externalRequests.thirdParty }),
};

const handleError = (message: string) => FieldErrors({ handle: { code: "BLUESKY_HANDLE_INVALID", message } });

export default class BlueskyConnection extends Connection {
    public readonly id = "bluesky";
    public readonly friendlyName = "Bluesky";
    public readonly setupUrl = "https://atproto.com/specs/oauth";
    public readonly requiredScopes = [SCOPE];
    settings: BlueskySettings = new BlueskySettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<BlueskySettings>(this.id, this.settings);
    }

    public get isConfigured(): boolean {
        return !!publicWebOrigin();
    }

    get isLoopback() {
        return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(publicWebOrigin()).hostname);
    }

    getRedirectUri() {
        if (!this.isLoopback) return super.getRedirectUri();
        const url = new URL(super.getRedirectUri());
        url.hostname = "127.0.0.1";
        return url.toString();
    }

    get clientMetadataUrl() {
        const api = Config.get().api.endpointPublic;
        const base = api && /^https:\/\//.test(api) ? api.replace(/\/$/, "") : `${publicWebOrigin()}/api/v9`;
        return `${base}/connections/${this.id}/client-metadata.json`;
    }

    get clientId() {
        if (!this.isLoopback) return this.clientMetadataUrl;
        return `http://localhost?${new URLSearchParams({ redirect_uri: this.getRedirectUri(), scope: SCOPE })}`;
    }

    clientMetadata() {
        return {
            client_id: this.clientId,
            client_name: Config.get().client.instanceName,
            client_uri: publicWebOrigin(),
            application_type: "web",
            grant_types: ["authorization_code"],
            response_types: ["code"],
            redirect_uris: [this.getRedirectUri()],
            scope: SCOPE,
            token_endpoint_auth_method: "none",
            dpop_bound_access_tokens: true,
        };
    }

    async getAuthorizationUrl(userId: string, options: AuthorizationOptions = {}): Promise<string> {
        const target = normalizeHandle(options.handle ?? "");
        if (!target) throw handleError("Enter your Bluesky handle, like example.bsky.social.");

        const did = target.did ?? (await resolveHandle(network, target.handle));
        if (!did) throw handleError(`We couldn't find a Bluesky account for ${target.handle}. Check the spelling and try again.`);
        const doc = await resolveDid(network, did);
        const pds = doc ? pdsEndpoint(doc) : null;
        const server = pds ? await authorizationServerFor(network, pds) : null;
        if (!server) throw handleError("We couldn't reach the server that hosts this Bluesky account. Try again in a moment.");

        const key = createDpopKey();
        const { verifier, challenge } = pkcePair();
        const pending: PendingLogin = { verifier, key, issuer: server.issuer, tokenEndpoint: server.token_endpoint };
        const state = this.createState(userId, { ...pending });

        const request = new URLSearchParams({
            client_id: this.clientId,
            response_type: "code",
            redirect_uri: this.getRedirectUri(),
            scope: SCOPE,
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
            login_hint: target.handle ?? did,
        });
        const par = await dpopPost<{ request_uri?: string; error?: string }>(network, server.pushed_authorization_request_endpoint, request, key).catch(() => null);
        if (!par || par.status >= 300 || !par.body.request_uri) {
            this.states.delete(state);
            console.warn(`[Connections/${this.id}] pushed authorization request failed with ${par?.status ?? "no answer"} ${par?.body.error ?? ""}`);
            throw handleError("The Bluesky sign in page couldn't be opened. Try again in a moment.");
        }
        const entry = this.states.get(state);
        if (entry?.data) entry.data.nonce = par.nonce;

        const url = new URL(server.authorization_endpoint);
        url.searchParams.set("client_id", this.clientId);
        url.searchParams.set("request_uri", par.body.request_uri);
        return url.toString();
    }

    async handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null> {
        const { userId, data } = this.validateState(params.state);
        const pending = data as unknown as PendingLogin;
        if (!params.code) throw providerFailure(this.friendlyName, "the sign in was cancelled.");
        if (params.iss !== pending.issuer) throw providerFailure(this.friendlyName, "the sign in came back from a different server than expected.");

        const token = await dpopPost<TokenResponse>(
            network,
            pending.tokenEndpoint,
            new URLSearchParams({
                grant_type: "authorization_code",
                code: params.code,
                redirect_uri: this.getRedirectUri(),
                client_id: this.clientId,
                code_verifier: pending.verifier,
            }),
            pending.key,
            pending.nonce,
        ).catch(() => null);
        const sub = token?.body.sub;
        if (!token || token.status >= 300 || !sub || !isAtprotoDid(sub) || !token.body.scope?.split(" ").includes(SCOPE))
            throw providerFailure(this.friendlyName, "the sign in couldn't be completed. Try connecting again.");

        const doc = await resolveDid(network, sub);
        const pds = doc ? pdsEndpoint(doc) : null;
        const server = pds ? await authorizationServerFor(network, pds) : null;
        if (!doc || server?.issuer !== pending.issuer) throw providerFailure(this.friendlyName, "the account isn't hosted by the server that signed you in.");

        const handle = claimedHandle(doc);
        const name = handle && (await resolveHandle(network, handle)) === sub ? handle : sub;

        if (await this.hasConnection(userId, sub)) return null;

        return await this.createConnection({
            user_id: userId,
            external_id: sub,
            friend_sync: params.friend_sync,
            name,
            type: this.id,
        });
    }
}
