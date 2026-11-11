import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/codes", route({}), (req: Request, res: Response) => {
    res.json([]);
});

export default router;
