import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), (req: Request, res: Response) => {
    res.json({ messages: [], channel_id: null, guild_id: null });
});

export default router;
