import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Channel } from "@spacebar/database";
import { DiscordApiErrors, DmChannelDTO } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: { body: "DmChannelDTO" },
            404: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { user_id } = req.params as { [key: string]: string };
        if (!/^\d{1,20}$/.test(user_id) || user_id === req.user_id) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        const found = await Channel.createQueryBuilder("channel")
            .select("channel.id")
            .innerJoin("channel.recipients", "mine", "mine.user_id = :me", { me: req.user_id })
            .innerJoin("channel.recipients", "theirs", "theirs.user_id = :them", { them: user_id })
            .where("channel.type = :type", { type: ChannelType.DM })
            .getOne();
        if (!found) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        const channel = await Channel.findOneOrFail({ where: { id: found.id }, relations: { recipients: true } });
        res.json(await DmChannelDTO.from(channel, [req.user_id]));
    },
);

export default router;
