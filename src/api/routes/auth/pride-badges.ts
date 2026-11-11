import { route } from "@spacebar/api/middlewares";
import { publicPrideBadges } from "@spacebar/api/util/utility/prideBadgeSelection";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} }, authentication: "never", spacebarOnly: true }), (req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=300").json(publicPrideBadges());
});

export default router;
