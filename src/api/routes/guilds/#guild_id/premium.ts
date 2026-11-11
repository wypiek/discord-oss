import { Router, Request, Response } from "express";
import { route } from "@spacebar/api/middlewares";
const router = Router({ mergeParams: true });

router.get("/subscriptions", route({}), (req: Request, res: Response) => {
    // TODO:
    res.json([]);
});

export default router;
