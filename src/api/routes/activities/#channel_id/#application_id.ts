import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { launchActivity } from "@spacebar/api/activities";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const { session_id } = (req.body ?? {}) as { session_id?: string };
    const { data } = await launchActivity({
        userId: req.user_id,
        applicationId: req.params.application_id as string,
        channelId: req.params.channel_id as string,
        sessionId: typeof session_id === "string" ? session_id : undefined,
    });
    res.json(data);
});

export default router;
