import { Request, Response, Router, urlencoded } from "express";
import { route } from "@spacebar/api/middlewares";
import { authenticateClient, isPublicClient, OAuth2Error, revokeOAuth2Grant } from "@spacebar/api/util";
import { OAuth2Token } from "@spacebar/database";
import { hashOAuth2Token } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    urlencoded({ extended: false }),
    route({
        authentication: "never",
        description: "Revoke an OAuth2 access or refresh token, invalidating every token the application holds for that user",
        responses: { 200: {}, 400: {}, 401: {} },
    }),
    async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const app = await authenticateClient(req, isPublicClient);
        if (typeof body.token !== "string" || !body.token) throw OAuth2Error("invalid_request", 'Missing "token" in request.');
        if (body.token.length > 512) throw OAuth2Error("invalid_request", '"token" must be 512 or fewer characters.');
        const hash = hashOAuth2Token(body.token);
        const row = await OAuth2Token.findOne({
            where: [
                { access_token_hash: hash, application_id: app.id },
                { refresh_token_hash: hash, application_id: app.id },
            ],
            select: { id: true, user_id: true, application_id: true },
        });
        if (row) await revokeOAuth2Grant(row.user_id, row.application_id);
        res.json({});
    },
);

export default router;
