import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router: Router = Router({ mergeParams: true });

router.patch("/", route({ responses: { 204: {} } }), (req: Request, res: Response) => {
    res.sendStatus(204);
});

export default router;
