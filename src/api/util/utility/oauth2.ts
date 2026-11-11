import crypto from "node:crypto";
import { Request } from "express";
import { IsNull, LessThan } from "typeorm";
import { Application, ApplicationAuthorization, OAuth2Token, User } from "@spacebar/database";
import { emitEvent, hashOAuth2Token, JwtKeypairManager, OAuth2TokenDeleteEvent, Snowflake } from "@spacebar/util";
import { ResponseError } from "./mfa";

export const OAUTH2_TOKEN_TTL = 604800;
export const OAUTH2_CODE_TTL = 600;
export const PUBLIC_OAUTH2_CLIENT = 1 << 8;
export const CLIENT_CREDENTIALS_SCOPES = [
    "identify",
    "email",
    "connections",
    "guilds",
    "guilds.members.read",
    "applications.commands.update",
    "applications.commands.permissions.update",
    "applications.entitlements",
    "role_connections.write",
];

export const OAUTH2_SCOPES = [
    "activities.read",
    "activities.write",
    "applications.builds.read",
    "applications.builds.upload",
    "applications.commands",
    "applications.commands.update",
    "applications.commands.permissions.update",
    "applications.entitlements",
    "applications.store.update",
    "bot",
    "connections",
    "dm_channels.read",
    "email",
    "gdm.join",
    "guilds",
    "guilds.join",
    "guilds.members.read",
    "identify",
    "identify.premium",
    "messages.read",
    "openid",
    "relationships.read",
    "role_connections.write",
    "rpc",
    "rpc.activities.write",
    "rpc.notifications.read",
    "rpc.voice.read",
    "rpc.voice.write",
    "voice",
    "webhook.incoming",
];

export const OAuth2Error = (error: string, error_description: string, status = 400) => new ResponseError(status, { error, error_description });

export const invalidScopeError = () => OAuth2Error("invalid_scope", "The requested scope is invalid, unknown, or malformed.");

export function parseOAuth2Scopes(scope: unknown, fallback: string[] = []) {
    const scopes = String(scope ?? "")
        .split(/[\s+]+/)
        .filter(Boolean);
    if (scopes.some((name) => !OAUTH2_SCOPES.includes(name))) throw invalidScopeError();
    return [...new Set(scopes.length ? scopes : fallback)];
}

export const randomOAuth2Token = () => crypto.randomBytes(24).toString("base64url");

const refreshTokenMac = (family: string, nonce: string) =>
    crypto
        .createHmac("sha256", JwtKeypairManager.keypair.privateKey.export({ format: "pem", type: "sec1" }))
        .update(`oauth2-refresh\n${family}\n${nonce}`)
        .digest("base64url");

export const signRefreshToken = (family: string) => {
    const nonce = randomOAuth2Token();
    return `${family}.${nonce}.${refreshTokenMac(family, nonce)}`;
};

export const refreshTokenFamily = (token: string) => {
    const [family, nonce, mac, ...rest] = token.split(".");
    if (rest.length || !/^\d{1,20}$/.test(family ?? "") || !nonce || !mac) return null;
    const expected = Buffer.from(refreshTokenMac(family, nonce));
    const given = Buffer.from(mac);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? family : null;
};

export const hashClientSecret = (secret: string) => hashOAuth2Token(secret);

export const pkceChallenge = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

export function clientCredentialsOf(req: Request) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const basic = req.headers.authorization?.match(/^Basic\s+(.+)$/i);
    if (basic) {
        const decoded = Buffer.from(basic[1], "base64").toString("utf8");
        const split = decoded.indexOf(":");
        if (split !== -1)
            return {
                client_id: decodeURIComponent(decoded.slice(0, split)),
                client_secret: decodeURIComponent(decoded.slice(split + 1)),
            };
    }
    return {
        client_id: typeof body.client_id === "string" ? body.client_id : undefined,
        client_secret: typeof body.client_secret === "string" && body.client_secret ? body.client_secret : undefined,
    };
}

export async function authenticateClient(req: Request, secretOptional: (app: Application) => boolean) {
    const { client_id, client_secret } = clientCredentialsOf(req);
    if (!client_id || !/^\d{1,20}$/.test(client_id)) throw OAuth2Error("invalid_client", "Unknown client", 401);
    const app = await Application.findOne({
        where: { id: client_id },
        select: {
            id: true,
            name: true,
            owner_id: true,
            flags: true,
            redirect_uris: true,
            client_secret_hash: true,
            team: { id: true, owner_user_id: true },
        },
        relations: { team: true },
    });
    if (!app) throw OAuth2Error("invalid_client", "Unknown client", 401);
    if (client_secret === undefined) {
        if (secretOptional(app)) return app;
        throw OAuth2Error("invalid_client", "Missing client_secret", 401);
    }
    const expected = Buffer.from(app.client_secret_hash ?? "");
    const given = Buffer.from(hashClientSecret(client_secret));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw OAuth2Error("invalid_client", "Invalid client_secret", 401);
    return app;
}

export const isPublicClient = (app: Application) => (Number(app.flags ?? 0) & PUBLIC_OAUTH2_CLIENT) === PUBLIC_OAUTH2_CLIENT;

export async function issueOAuth2Token(opts: { user_id: string; application_id: string; authorization_id?: string; scopes: string[]; refresh: boolean; code_hash?: string }) {
    const id = Snowflake.generate();
    const access_token = randomOAuth2Token();
    const refresh_token = opts.refresh ? signRefreshToken(id) : undefined;
    await OAuth2Token.delete({ refresh_token_hash: IsNull(), expires_at: LessThan(new Date()) });
    await OAuth2Token.create({
        id,
        user_id: opts.user_id,
        application_id: opts.application_id,
        authorization_id: opts.authorization_id,
        scopes: opts.scopes,
        access_token_hash: hashOAuth2Token(access_token),
        refresh_token_hash: refresh_token ? hashOAuth2Token(refresh_token) : null,
        code_hash: opts.code_hash ?? null,
        expires_at: new Date(Date.now() + OAUTH2_TOKEN_TTL * 1000),
        created_at: new Date(),
    }).save();
    return oauth2TokenResponse(access_token, opts.scopes, refresh_token);
}

export const oauth2TokenResponse = (access_token: string, scopes: string[], refresh_token?: string) => ({
    token_type: "Bearer",
    access_token,
    expires_in: OAUTH2_TOKEN_TTL,
    ...(refresh_token && { refresh_token }),
    scope: scopes.join(" "),
});

export async function revokeOAuth2Grant(user_id: string, application_id: string) {
    await OAuth2Token.delete({ user_id, application_id });
    const authorization = await ApplicationAuthorization.findOne({
        where: { user_id, application_id },
    });
    if (!authorization || authorization.integration_type === 1) return;
    await ApplicationAuthorization.delete({ id: authorization.id });
    await emitEvent({
        event: "OAUTH2_TOKEN_DELETE",
        user_id,
        data: { id: authorization.id, application_id },
    } satisfies OAuth2TokenDeleteEvent);
}

export const oauth2User = (user: User, scopes: string[]) => ({
    ...user.toPartialUser(),
    flags: Number(user.flags ?? 0),
    premium_type: user.premium_type ?? 0,
    mfa_enabled: !!user.mfa_enabled,
    locale: user.settings?.locale ?? "en-US",
    ...(scopes.includes("email") && { email: user.email ?? null, verified: !!user.verified }),
});
