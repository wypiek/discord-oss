import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Message } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { finalizePoll } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ permission: "VIEW_CHANNEL" }), async (req: Request, res: Response) => {
    const { poll_id, channel_id } = req.params as { [key: string]: string };

    const message = await Message.findOne({ where: { id: poll_id, channel_id } });

    if (!message) throw DiscordApiErrors.UNKNOWN_MESSAGE;
    if (!message.poll) throw DiscordApiErrors.NON_POLL_MESSAGE_CANNOT_EXPIRE;
    if (message.poll.results?.is_finalized || new Date() > new Date(message.poll.expiry)) throw DiscordApiErrors.POLL_EXPIRED;
    if (message.author_id !== req.user_id) req.permission?.hasThrow("MANAGE_MESSAGES");

    const finalized = await finalizePoll(message.id);
    res.json(finalized?.toPublicJSON(req.user_id));
});

export default router;
