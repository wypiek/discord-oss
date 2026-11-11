import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ActivityInstances } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const instance = await ActivityInstances.find(req.params.application_id as string, req.params.instance_id as string);
    const { session_id } = (req.body ?? {}) as { session_id?: string };
    if (instance) await ActivityInstances.leave(instance, req.user_id, typeof session_id === "string" ? session_id : undefined);
    res.sendStatus(204);
});

export default router;
