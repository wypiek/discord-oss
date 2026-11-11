import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    res.json({ balance: 0 });
});

export default router;
