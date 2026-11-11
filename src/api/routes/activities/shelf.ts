import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { activityShelf } from "@spacebar/api/activities";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json(await activityShelf(req.user_id));
});

export default router;
