import { route } from "@spacebar/api/middlewares";
import { Collectibles } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json({ categories: await Collectibles.categories(), collections: [] });
});

export default router;
