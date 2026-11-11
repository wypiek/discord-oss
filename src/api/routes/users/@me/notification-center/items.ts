import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), (req: Request, res: Response) => {
    const requested = Number(req.query.limit);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 20;
    res.json({ limit, items: [], cursor: null, has_more: false });
});

export default router;
