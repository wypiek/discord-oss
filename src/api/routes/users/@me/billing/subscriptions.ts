import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router: Router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    //TODO
    res.json([]).status(200);
});

export default router;
