import { route } from "@spacebar/api/middlewares";
import { Collectibles } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: { body: "CollectiblesCategoriesResponse" } } }), async (req: Request, res: Response) => {
    res.json(await Collectibles.categories());
});

export default router;
