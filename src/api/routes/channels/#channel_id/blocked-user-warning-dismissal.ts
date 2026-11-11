import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Channel, Recipient } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            204: {},
            404: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const channel = await Channel.findOne({ where: { id: channel_id }, select: { id: true, type: true } });
        if (channel?.type !== ChannelType.GROUP_DM) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        const { affected } = await Recipient.update({ channel_id, user_id: req.user_id }, { blocked_user_warning_dismissed: true });
        if (!affected) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        res.sendStatus(204);
    },
);

export default router;
