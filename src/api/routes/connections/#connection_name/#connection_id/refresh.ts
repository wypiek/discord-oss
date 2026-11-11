import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.post("/", route({}), (req: Request, res: Response) => {
    // TODO:
    // const { connection_name, connection_id } = req.params;
    res.sendStatus(204);
});

export default router;
