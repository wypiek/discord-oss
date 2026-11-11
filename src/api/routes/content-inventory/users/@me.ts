import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), (req: Request, res: Response) => {
    res.json({
        request_id: null,
        entries: [],
        unranked_game_entries: [],
        expired_at: null,
        refresh_stale_inbox_after_ms: null,
        wait_ms_until_next_fetch: 30 * 60 * 1000,
    });
});

export default router;
