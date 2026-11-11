import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { ScheduledMessage, ScheduledMessageState } from "@spacebar/database";
import { dispatchScheduledMessage } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: { 204: {}, 400: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const scheduled = await ScheduledMessage.findOne({
            where: { id: req.params.scheduled_message_id as string, user_id: req.user_id },
        });
        if (!scheduled) throw new HTTPError("Unknown scheduled message", 404);
        if (scheduled.state !== ScheduledMessageState.SCHEDULED) {
            await ScheduledMessage.update({ id: scheduled.id }, { state: ScheduledMessageState.SCHEDULED });
            scheduled.state = ScheduledMessageState.SCHEDULED;
        }
        if (!(await dispatchScheduledMessage(scheduled))) throw new HTTPError("Failed to send the scheduled message", 400);
        res.sendStatus(204);
    },
);

export default router;
