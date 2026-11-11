import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { badgeDirectory, loadBadgeOwner } from "@spacebar/api/util/utility/profileBadges";
import { HTTPError } from "lambert-server/HTTPError";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        description: "One profile badge a user owns.",
    }),
    async (req: Request, res: Response) => {
        const { user, self } = await loadBadgeOwner(req.params.user_id as string, req.user_id);
        const badge = (await badgeDirectory(user, self)).find((item) => String(item.badge_id) === req.params.badge_id);
        if (!badge) throw new HTTPError("Unknown badge", 404);
        res.json(badge);
    },
);

export default router;
