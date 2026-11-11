import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    res.sendStatus(204);
});

export default router;
