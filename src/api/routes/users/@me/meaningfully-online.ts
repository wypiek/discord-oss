import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.post("/", route({}), (req: Request, res: Response) => {
    res.sendStatus(204);
});

export default router;
