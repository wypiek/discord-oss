import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/eligibility", route({}), (req: Request, res: Response) => {
    res.json({
        referrals_remaining: 0,
        sent_user_ids: [],
        refresh_at: null,
        recipient_status: {},
        has_eligible_friends: false,
    });
});

export default router;
