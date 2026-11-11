import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { oauth2User } from "@spacebar/api/util";
import { Application, User } from "@spacebar/database";
import { ApiError } from "@spacebar/util";
import { PrivateUserProjection } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        oauth2: [],
        description: "Get the current OAuth2 authorization of a bearer token",
        responses: { 200: {}, 401: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        if (!req.oauth2) throw new ApiError("401: Unauthorized", 0, 401);
        const { application_id, scopes, expires_at } = req.oauth2;
        const app = await Application.findOneOrFail({ where: { id: application_id } });
        const user = scopes.includes("identify")
            ? await User.findOneOrFail({
                  where: { id: req.user_id },
                  select: Object.fromEntries(PrivateUserProjection.map((i) => [i, true])),
                  relations: { avatar_decoration: true, settings: true },
              })
            : undefined;
        res.json({
            application: {
                id: app.id,
                name: app.name,
                icon: app.icon ?? null,
                description: app.description ?? "",
                type: null,
                bot_public: app.bot_public ?? true,
                bot_require_code_grant: app.bot_require_code_grant ?? false,
                verify_key: app.verify_key,
                flags: app.flags ?? 0,
                hook: app.hook,
            },
            scopes,
            expires: expires_at.toISOString(),
            ...(user && { user: oauth2User(user, scopes) }),
        });
    },
);

export default router;
