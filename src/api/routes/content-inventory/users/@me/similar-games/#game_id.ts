import { route } from "@spacebar/api/middlewares";
import { DetectableGames } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { games } = await DetectableGames.load();
    res.json({ similar_games: DetectableGames.similar(req.params.game_id as string, games) });
});

export default router;
