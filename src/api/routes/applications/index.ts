import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ensureInteractionKeys, toOwnedApplication } from "@spacebar/api/util/handlers/Application";
import { Application } from "@spacebar/database";
import { createAppBotUser } from "@spacebar/util";
import { ApplicationCreateSchema } from "@spacebar/schemas";
import { trimSpecial } from "@spacebar/extensions";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "APIApplicationArray",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const results = await Application.find({
            where: { owner: { id: req.user_id } },
            relations: { owner: true, bot: true },
        });
        res.json(results.map(toOwnedApplication));
    },
);

router.post(
    "/",
    route({
        requestBody: "ApplicationCreateSchema",
        responses: {
            200: {
                body: "Application",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as ApplicationCreateSchema;

        const app = Application.create({
            name: trimSpecial(body.name),
            description: "",
            bot_public: true,
            owner: req.user,
            verify_key: "IMPLEMENTME",
            flags: 0,
        });

        await createAppBotUser(app, req);
        await ensureInteractionKeys(app.id);
        app.verify_key = (
            await Application.findOneOrFail({
                where: { id: app.id },
                select: { id: true, verify_key: true },
            })
        ).verify_key;

        res.json(toOwnedApplication(app));
    },
);

export default router;
