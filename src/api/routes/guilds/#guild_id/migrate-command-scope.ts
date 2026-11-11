import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.post("/", route({ permission: "MANAGE_GUILD" }), async (_req: Request, res: Response) => {
    res.json({ integration_ids_with_app_commands: [] });
});

export default router;
