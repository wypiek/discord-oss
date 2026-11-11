import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Application } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { toOwnedApplication } from "@spacebar/api/util/handlers/Application";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "Application",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const app = await Application.findOne({
            where: { id: req.user_id },
            relations: { bot: true, owner: true },
        });
        if (!app?.bot) throw DiscordApiErrors.BOT_ONLY_ENDPOINT;
        res.json(toOwnedApplication(app));
    },
);
export default router;
