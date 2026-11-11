import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { PushDevice, User } from "@spacebar/database";
import { FieldErrors, JwtKeypairManager, isPublicUrl } from "@spacebar/util";
import { PushDeviceSchema, PushDeviceSyncSchema } from "@spacebar/schemas";
import { vapidPublicKey } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const MAX_DEVICES = 20;
const SYNC_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const invalid = (message: string) => FieldErrors({ token: { code: "BASE_TYPE_INVALID", message } });

async function parseWebPushToken(token: string) {
    let subscription: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    try {
        subscription = JSON.parse(token);
    } catch {
        throw invalid("Expected a JSON push subscription.");
    }
    const { endpoint, keys } = subscription ?? {};
    if (typeof endpoint !== "string" || endpoint.length > 2048 || !(await isPublicUrl(endpoint, { httpsOnly: true })))
        throw invalid("The push endpoint must be a public https URL.");
    if (typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") throw invalid("The push subscription has no keys.");
    const p256dh = Buffer.from(keys.p256dh, "base64url");
    const auth = Buffer.from(keys.auth, "base64url");
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw invalid("The push subscription keys are malformed.");
    return {
        endpoint,
        keys: { p256dh: p256dh.toString("base64url"), auth: auth.toString("base64url") },
    };
}

async function parseDevice(rawProvider: string, rawToken: string) {
    const provider = rawProvider.toLowerCase();
    if (provider === "webpush" && !vapidPublicKey()) throw invalid("Web push is disabled on this instance.");
    const subscription = provider === "webpush" ? await parseWebPushToken(rawToken) : null;
    return { provider, token: subscription?.endpoint ?? rawToken, keys: subscription?.keys ?? null };
}

async function registerDevice(
    user_id: string,
    session_id: string | null,
    device: { provider: string; token: string; keys: { p256dh: string; auth: string } | null; voip_provider?: string | null; voip_token?: string | null },
    exclusive = true,
) {
    await PushDevice.delete(exclusive ? { provider: device.provider, token: device.token } : { user_id, provider: device.provider, token: device.token });
    await PushDevice.create({
        user_id,
        session_id,
        provider: device.provider,
        token: device.token,
        keys: device.keys,
        voip_provider: device.voip_provider ?? null,
        voip_token: device.voip_token ?? null,
    }).save();

    const stale = await PushDevice.find({
        where: { user_id },
        order: { created_at: "DESC" },
        skip: MAX_DEVICES,
        select: { id: true },
    });
    if (stale.length) await PushDevice.delete(stale.map((device) => device.id));
}

const syncTokenSignature = (user_id: string, payload: string) => {
    const secret = hkdfSync("sha256", JwtKeypairManager.keypair.privateKey.export({ format: "der", type: "pkcs8" }), user_id, "push-sync-token", 32);
    return createHmac("sha256", Buffer.from(secret)).update(payload).digest();
};

async function userForSyncToken(syncToken: unknown) {
    if (typeof syncToken !== "string" || syncToken.length > 256) return null;
    const [encodedUser, encodedIssued, signature, extra] = syncToken.split(".");
    if (!encodedUser || !encodedIssued || !signature || extra !== undefined) return null;
    const user_id = Buffer.from(encodedUser, "base64url").toString();
    const issued = Number(Buffer.from(encodedIssued, "base64url").toString());
    if (!/^\d{1,20}$/.test(user_id) || !Number.isSafeInteger(issued)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (issued > now + 60 || now - issued > SYNC_TOKEN_LIFETIME_SECONDS) return null;
    const expected = syncTokenSignature(user_id, `${encodedUser}.${encodedIssued}`);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const user = await User.findOne({ where: { id: user_id }, select: { id: true, data: true, deleted: true, disabled: true } });
    if (!user || user.deleted || user.disabled) return null;
    if (user.data?.valid_tokens_since && issued * 1000 < new Date(user.data.valid_tokens_since).getTime() - 999) return null;
    return user.id;
}

router.get(
    "/sync-token",
    route({
        responses: {
            200: { body: "PushDeviceSyncTokenResponse" },
        },
    }),
    (req: Request, res: Response) => {
        const payload = `${Buffer.from(req.user_id).toString("base64url")}.${Buffer.from(String(Math.floor(Date.now() / 1000))).toString("base64url")}`;
        res.json({ token: `${payload}.${syncTokenSignature(req.user_id, payload).toString("base64url")}` });
    },
);

router.put(
    "/sync",
    route({
        requestBody: "PushDeviceSyncSchema",
        responses: {
            200: { body: "PushDeviceSyncResponse" },
            400: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as PushDeviceSyncSchema;
        const device = await parseDevice(body.provider, body.token);
        const syncTokens = [...new Set(body.push_sync_tokens ?? [])];
        if (syncTokens.length > MAX_DEVICES) throw FieldErrors({ push_sync_tokens: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${MAX_DEVICES} or fewer in length.` } });
        const invalid_push_sync_tokens: string[] = [];
        const users = new Set<string>();
        for (const syncToken of syncTokens) {
            const user_id = await userForSyncToken(syncToken);
            if (user_id) users.add(user_id);
            else invalid_push_sync_tokens.push(syncToken);
        }
        await PushDevice.delete({ provider: device.provider, token: device.token });
        for (const user_id of users) await registerDevice(user_id, user_id === req.user_id ? (req.session?.session_id ?? null) : null, device, false);
        res.json({ invalid_push_sync_tokens });
    },
);

router.get(
    "/web-push",
    route({
        responses: {
            200: {},
        },
    }),
    (req: Request, res: Response) => {
        const public_key = vapidPublicKey();
        res.json({ enabled: !!public_key, public_key });
    },
);

router.post(
    "/",
    route({
        requestBody: "PushDeviceSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as PushDeviceSchema;
        const device = await parseDevice(body.provider, body.token);
        await registerDevice(req.user_id, req.session?.session_id ?? null, { ...device, voip_provider: body.voip_provider ?? null, voip_token: body.voip_token ?? null });
        res.sendStatus(204);
    },
);

router.delete(
    "/",
    route({
        requestBody: "PushDeviceSchema",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as PushDeviceSchema;
        const provider = body.provider.toLowerCase();
        const token = (() => {
            if (provider !== "webpush") return body.token;
            try {
                const endpoint = JSON.parse(body.token)?.endpoint;
                return typeof endpoint === "string" ? endpoint : body.token;
            } catch {
                return body.token;
            }
        })();
        await PushDevice.delete({ user_id: req.user_id, provider, token });
        res.sendStatus(204);
    },
);

export default router;
