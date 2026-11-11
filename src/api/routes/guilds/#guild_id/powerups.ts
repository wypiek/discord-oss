import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { guildPowerupEntitlements } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json(guildPowerupEntitlements(req.params.guild_id as string, req.user_id));
});

export default router;
