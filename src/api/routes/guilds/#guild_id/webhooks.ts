import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Webhook } from "@spacebar/database";
import { webhookToJSON } from "@spacebar/api/util/handlers/Webhook";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        description: "Returns a list of guild webhook objects. Requires the MANAGE_WEBHOOKS permission.",
        permission: "MANAGE_WEBHOOKS",
        responses: {
            200: {
                body: "WebhookListResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const webhooks = await Webhook.find({
            where: { guild_id },
            relations: {
                user: true,
                channel: true,
                source_channel: true,
                guild: true,
                source_guild: true,
                application: true,
            },
        });

        return res.json(webhooks.map((webhook) => webhookToJSON(webhook)));
    },
);

export default router;
