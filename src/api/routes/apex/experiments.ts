import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { getApexExperiments } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({ authentication: "optional" }), (req: Request, res: Response) => {
    res.json(getApexExperiments(req.user_id));
});

export default router;
