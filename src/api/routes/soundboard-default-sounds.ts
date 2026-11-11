import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { DEFAULT_SOUNDBOARD_SOUNDS } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), (req: Request, res: Response) => {
    res.json(DEFAULT_SOUNDBOARD_SOUNDS);
});

export default router;
