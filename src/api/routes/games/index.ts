import { route } from "@spacebar/api/middlewares";
import { DetectableGames } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { game_ids } = req.query;
    const ids = [game_ids]
        .flat()
        .flatMap((x) => (typeof x === "string" ? x.split(",") : []))
        .slice(0, 100);
    const { byId } = await DetectableGames.load();
    res.json(ids.flatMap((id) => (byId.has(id) ? [DetectableGames.toGame(byId.get(id)!)] : [])));
});

export default router;
