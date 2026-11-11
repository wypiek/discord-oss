import { Router, Request, Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { User } from "@spacebar/database";
import { OAuth2UserInfoResponse } from "@spacebar/schemas/api/oauth2/OAuth2UserInfo";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        description: "Get standard OAuth2 user info",
        oauth2: ["openid", "identify"],
        responses: {
            200: {
                body: "OAuth2UserInfoResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const emailScope = !req.oauth2 || req.oauth2.scopes.includes("email");
        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { id: true, username: true, avatar: true, email: true, verified: true },
            relations: { settings: true },
        });
        const cdn = Config.get().cdn.endpointPublic?.replace(/\/+$/, "");
        res.json({
            sub: user.id,
            email: emailScope ? (user.email ?? null) : null,
            email_verified: emailScope ? !!user.verified : false,
            preferred_username: user.username,
            nickname: user.username,
            picture: user.avatar ? `${cdn}/avatars/${user.id}/${user.avatar}.png` : `${cdn}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`,
            locale: user.settings?.locale ?? "en-US",
        } satisfies OAuth2UserInfoResponse);
    },
);

export default router;
