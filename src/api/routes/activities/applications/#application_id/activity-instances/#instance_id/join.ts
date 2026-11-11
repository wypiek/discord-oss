import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ActivityInstances } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { launchActivity } from "@spacebar/api/activities";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const instance = await ActivityInstances.find(req.params.application_id as string, req.params.instance_id as string);
    if (!instance) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const { session_id } = (req.body ?? {}) as { session_id?: string };
    const { data } = await launchActivity({
        userId: req.user_id,
        applicationId: instance.application_id,
        channelId: instance.channel_id,
        sessionId: typeof session_id === "string" ? session_id : undefined,
    });
    res.json(data);
});

export default router;
