import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { joinRequestGuildsForUser } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json(await joinRequestGuildsForUser(req.user_id));
});

export default router;
