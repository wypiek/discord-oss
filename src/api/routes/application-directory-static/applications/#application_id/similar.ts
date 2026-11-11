import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (_req: Request, res: Response) => {
    res.json({ applications: [], num_pages: 0, load_id: randomUUID() });
});

export default router;
