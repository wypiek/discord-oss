import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "never" }), (req: Request, res: Response) => {
    res.sendStatus(200);
});

export default router;
