import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json([]);
});

router.put("/", route({ permission: "MANAGE_ROLES" }), async (req: Request, res: Response) => {
    res.json(Array.isArray(req.body) ? req.body : []);
});

export default router;
