import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Channel, ScheduledMessage, User } from "@spacebar/database";
import { scheduledMessageJSON, validateScheduledContent, validateScheduledSendAt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

async function findOwn(req: Request) {
    const scheduled = await ScheduledMessage.findOne({
        where: { id: req.params.scheduled_message_id as string, user_id: req.user_id },
    });
    if (!scheduled) throw new HTTPError("Unknown scheduled message", 404);
    return scheduled;
}

router.patch(
    "/",
    route({
        responses: { 200: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const scheduled = await findOwn(req);
        const body = req.body ?? {};
        if (body.scheduled_timestamp != null) scheduled.send_at = validateScheduledSendAt(body.scheduled_timestamp);
        if (body.content != null || body.flags != null) {
            scheduled.payload = {
                ...scheduled.payload,
                content: body.content ?? scheduled.payload.content,
                flags: body.flags ?? scheduled.payload.flags,
            };
            validateScheduledContent(scheduled.payload);
        }
        await scheduled.save();
        const channel = await Channel.findOne({
            where: { id: scheduled.channel_id },
            select: { id: true, guild_id: true },
        });
        res.json(scheduledMessageJSON(scheduled, await User.findOneOrFail({ where: { id: req.user_id } }), channel?.guild_id));
    },
);

router.delete("/", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const scheduled = await findOwn(req);
    await ScheduledMessage.delete({ id: scheduled.id });
    res.sendStatus(204);
});

export default router;
