import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Channel, User } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const channel = await Channel.findOne({
        where: { id: req.params.channel_id as string },
        relations: { recipients: true },
    });
    if (!channel || !channel.recipients?.some((r) => r.user_id === req.user_id)) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    const others = channel.recipients.map((r) => r.user_id).filter((id) => id !== req.user_id);
    const bots = channel.type === ChannelType.DM && others.length ? await User.find({ where: { id: In(others), bot: true }, select: { id: true } }) : [];
    res.json(
        await buildCommandIndex(
            bots.map((b) => b.id),
            { context: 1, integrationType: 0 },
        ),
    );
});

export default router;
