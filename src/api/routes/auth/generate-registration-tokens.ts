import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { ValidRegistrationToken } from "@spacebar/database";
import { Random } from "@spacebar/extensions";
import { Config } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            count: {
                type: "number",
                description: "The number of registration tokens to generate. Defaults to 1.",
            },
            length: {
                type: "number",
                description: "The length of each registration token. Defaults to 255.",
            },
        },
        right: "CREATE_REGISTRATION_TOKENS",
        responses: { 200: { body: "GenerateRegistrationTokensResponse" } },
        spacebarOnly: true,
    }),
    async (req: Request, res: Response) => {
        const count = req.query.count ? parseInt(req.query.count as string) : 1;
        const length = req.query.length ? parseInt(req.query.length as string) : 255;
        if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new HTTPError("count must be between 1 and 1000", 400);
        if (!Number.isSafeInteger(length) || length < 16 || length > 255) throw new HTTPError("length must be between 16 and 255", 400);

        const tokens: ValidRegistrationToken[] = [];

        for (let i = 0; i < count; i++) {
            const token = ValidRegistrationToken.create({
                token: Random.getString("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", length),
                expires_at: new Date(Date.now() + Config.get().security.defaultRegistrationTokenExpiration),
            });
            tokens.push(token);
        }

        // Why are these options used, exactly?
        await ValidRegistrationToken.save(tokens, {
            chunk: 1000,
            reload: false,
            transaction: false,
        });

        const ret = req.query.include_url ? tokens.map((x) => `${Config.get().general.frontPage}/register?token=${x.token}`) : tokens.map((x) => x.token);

        if (req.query.plain) return res.send(ret.join("\n"));

        return res.json({ tokens: ret });
    },
);

export default router;
