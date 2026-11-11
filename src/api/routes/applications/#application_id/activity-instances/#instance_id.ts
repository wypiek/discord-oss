import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ActivityInstances } from "@spacebar/database";
import { ApiError, DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const applicationId = req.params.application_id as string;
    if (req.user_id !== applicationId) throw DiscordApiErrors.MISSING_ACCESS;
    const instance = await ActivityInstances.find(applicationId, req.params.instance_id as string);
    if (!instance) throw new ApiError("Unknown activity instance", 10070, 404);
    const data = await ActivityInstances.serialize(instance);
    res.json({
        application_id: data.application_id,
        instance_id: data.composite_instance_id,
        launch_id: data.launch_id,
        location: data.location,
        users: data.participants.map((p) => p.user_id),
    });
});

export default router;
