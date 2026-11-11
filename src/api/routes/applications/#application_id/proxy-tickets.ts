import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Channel, EmbeddedActivity } from "@spacebar/database";
import { DiscordApiErrors, getPermission } from "@spacebar/util";
import { signProxyTicket } from "@spacebar/api/activities";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const applicationId = req.params.application_id as string;
    if (!(await EmbeddedActivity.exists({ where: { application_id: applicationId } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const { channel_id } = (req.body ?? {}) as { channel_id?: string };
    if (typeof channel_id === "string") {
        const channel = await Channel.findOne({
            where: { id: channel_id },
            relations: { recipients: true },
        });
        if (!channel) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        (await getPermission(req.user_id, channel.guild_id ?? undefined, channel)).hasThrow("VIEW_CHANNEL");
    }
    res.json({
        ticket: signProxyTicket(req.user_id, applicationId, typeof channel_id === "string" ? channel_id : undefined),
    });
});

export default router;
