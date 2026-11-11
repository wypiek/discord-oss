import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/@me", route({}), (req: Request, res: Response) => {
    res.json({
        quests: [],
        excluded_quests: [],
        quest_enrollment_blocked_until: null,
        quest_access_suspended_until: null,
    });
});

router.get("/@me/claimed", route({}), (req: Request, res: Response) => {
    res.json({ quests: [] });
});

router.get("/decision", route({}), (req: Request, res: Response) => {
    res.json({
        request_id: null,
        quest: null,
        creative: null,
        ad_identifiers: null,
        ad_context: null,
        response_ttl_seconds: 86400,
    });
});

router.get("/get-decisions", route({}), (req: Request, res: Response) => {
    res.json({ request_id: null, decisions: [] });
});

export default router;
