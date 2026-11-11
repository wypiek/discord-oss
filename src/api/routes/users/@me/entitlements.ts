import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    res.json([]);
});

router.get("/gifts", route({}), (req: Request, res: Response) => {
    // TODO:
    res.json([]).status(200);
});

export default router;
