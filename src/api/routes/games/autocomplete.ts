import { route } from "@spacebar/api/middlewares";
import { DetectableGames } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const games = await DetectableGames.search(q);
    res.json(
        games.map((game) => ({
            id: game.id,
            name: game.name,
            icon: game.icon_hash ?? null,
            platform_availability: [],
        })),
    );
});

export default router;
