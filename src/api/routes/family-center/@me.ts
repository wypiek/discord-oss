import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    res.json({ teen_audit_log: null, linked_users: [], users: [] });
});

export default router;
