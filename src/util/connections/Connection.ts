import crypto from "node:crypto";
import { ConnectedAccount } from "../../database/entities";
import { ConnectedAccountSchema, ConnectionCallbackSchema } from "@spacebar/schemas";
import { Config, DiscordApiErrors } from "../util";
import { resolveConnectionOrigin } from "./ConnectionOrigin";

export interface ConnectionState {
    userId: string;
    expiresAt: number;
    data?: Record<string, unknown>;
}

export interface AuthorizationOptions {
    handle?: string;
}

const STATE_LIFETIME = 15 * 60 * 1000;
const MAX_STATES = 10_000;

export function connectionOriginSource() {
    const { general, api } = Config.get();
    return resolveConnectionOrigin(general, api);
}

export function publicWebOrigin() {
    return connectionOriginSource().origin;
}

export abstract class Connection {
    id: string;
    settings: { enabled: boolean };
    states: Map<string, ConnectionState> = new Map();

    public abstract readonly friendlyName: string;
    public abstract readonly setupUrl: string;
    public abstract readonly requiredScopes: string[];

    abstract init(): void;

    public abstract get isConfigured(): boolean;

    get requiredSettings(): string[] {
        return ["clientId", "clientSecret"].filter((field) => field in this.settings);
    }

    get isAvailable(): boolean {
        return !!this.settings.enabled && this.isConfigured;
    }

    abstract getAuthorizationUrl(userId: string, options?: AuthorizationOptions): string | Promise<string>;

    getRedirectUri() {
        return `${publicWebOrigin()}/connections/${this.id}/callback`;
    }

    abstract handleCallback(params: ConnectionCallbackSchema): Promise<ConnectedAccount | null>;

    private liveState(state: string) {
        const entry = this.states.get(state);
        if (!entry || entry.expiresAt <= Date.now()) {
            this.states.delete(state);
            throw DiscordApiErrors.INVALID_OAUTH_STATE;
        }
        return entry;
    }

    getUserId(state: string): string {
        return this.liveState(state).userId;
    }

    createState(userId: string, data?: Record<string, unknown>): string {
        const now = Date.now();
        if (this.states.size >= MAX_STATES) for (const [key, entry] of this.states) if (entry.expiresAt <= now) this.states.delete(key);
        if (this.states.size >= MAX_STATES) this.states.delete(this.states.keys().next().value as string);
        const state = crypto.randomBytes(16).toString("hex");
        this.states.set(state, { userId, expiresAt: now + STATE_LIFETIME, data });
        return state;
    }

    validateState(state: string): ConnectionState {
        const entry = this.liveState(state);
        this.states.delete(state);
        return entry;
    }

    async createConnection(data: ConnectedAccountSchema): Promise<ConnectedAccount> {
        const ca = ConnectedAccount.create({ ...data });
        await ca.save();
        return ca;
    }

    async hasConnection(userId: string, externalId: string): Promise<boolean> {
        const existing = await ConnectedAccount.findOne({
            where: {
                user_id: userId,
                external_id: externalId,
                type: this.id,
            },
        });

        return !!existing;
    }
}
