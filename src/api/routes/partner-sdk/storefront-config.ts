import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    res.json({ storefronts: [], announcement_modal_config: null });
});

export default router;
