import { route } from "@spacebar/api/middlewares";
import { DetectableGames } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    res.json({ suggested_games: await DetectableGames.suggested(), suggested_wishlist_games: [] });
});

export default router;
