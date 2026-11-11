import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, User } from "@spacebar/database";
import { MessageType } from "@spacebar/schemas";
import { postGuildSystemMessage, safetyChannelId } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            204: {},
            403: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        const channel_id = safetyChannelId(guild);
        if (channel_id)
            await postGuildSystemMessage({
                guild_id,
                channel_id,
                author: await User.findOneOrFail({ where: { id: req.user_id } }),
                type: MessageType.GUILD_INCIDENT_REPORT_RAID,
            });
        return res.status(204).send();
    },
);

export default router;
