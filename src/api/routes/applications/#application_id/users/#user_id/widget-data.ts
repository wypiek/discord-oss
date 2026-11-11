import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Application, ApplicationIdentity, User } from "@spacebar/database";
import { DiscordApiErrors, FieldErrors } from "@spacebar/util";
import { MAX_WIDGET_TEXT, parseIdentityData } from "@spacebar/api/util/handlers/ApplicationWidgets";

// Per-user values for an application's profile widget, the ones its fields read with value_type "data".
// The application's bot sets them with its token, and the owner can set them from their own account.
const router = Router({ mergeParams: true });

const resolve = async (req: Request) => {
    const app = await Application.findOne({
        where: { id: req.params.application_id as string },
        relations: { bot: true },
    });
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (req.user_id !== app.owner_id && req.user_id !== app.bot?.id) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
    const userId = req.params.user_id === "@me" ? req.user_id : (req.params.user_id as string);
    if (!(await User.exists({ where: { id: userId } }))) throw DiscordApiErrors.UNKNOWN_USER;
    return { app, userId };
};

const toResponse = (identity: ApplicationIdentity | null, applicationId: string, userId: string) => ({
    application_id: applicationId,
    user_id: userId,
    username: identity?.username ?? null,
    data: identity?.data ?? {},
    updated_at: identity?.updated_at ?? null,
});

const parseUsername = (value: unknown) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value !== "string" || value.length > MAX_WIDGET_TEXT)
        throw FieldErrors({
            username: {
                code: "BASE_TYPE_BAD_LENGTH",
                message: `Must be up to ${MAX_WIDGET_TEXT} characters long.`,
            },
        });
    return value;
};

router.get("/", route({ responses: { 200: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { app, userId } = await resolve(req);
    res.json(toResponse(await ApplicationIdentity.findOne({ where: { application_id: app.id, user_id: userId } }), app.id, userId));
});

// PUT replaces every value, PATCH changes only the keys it sends and removes the ones set to null.
const save = (merge: boolean) => async (req: Request, res: Response) => {
    const { app, userId } = await resolve(req);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw FieldErrors({ body: { code: "BASE_TYPE_INVALID", message: "Must be an object." } });
    const body = req.body as { username?: unknown; data?: Record<string, unknown> };
    const input = body.data === undefined ? {} : body.data;
    parseIdentityData(input);
    const existing = await ApplicationIdentity.findOne({
        where: { application_id: app.id, user_id: userId },
    });
    const removed = merge ? Object.keys(input).filter((key) => input[key] === null) : [];
    const merged = merge ? { ...existing?.data, ...input } : input;
    const data = parseIdentityData(Object.fromEntries(Object.entries(merged).filter(([key]) => !removed.includes(key))));
    const username = parseUsername(body.username);
    const identity = ApplicationIdentity.create({
        application_id: app.id,
        user_id: userId,
        data,
        username: username === undefined ? (merge ? existing?.username : null) : username,
        updated_at: new Date(),
    });
    await ApplicationIdentity.save(identity);
    res.json(toResponse(identity, app.id, userId));
};

router.put(
    "/",
    route({
        responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } },
    }),
    save(false),
);
router.patch(
    "/",
    route({
        responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } },
    }),
    save(true),
);

router.delete("/", route({ responses: { 204: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { app, userId } = await resolve(req);
    await ApplicationIdentity.delete({ application_id: app.id, user_id: userId });
    res.sendStatus(204);
});

export default router;
