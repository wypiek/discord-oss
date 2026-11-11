import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { badgeSettings, mergeBadgeSettings } from "@spacebar/api/util/utility/badgeSettings";
import { loadBadgeOwner } from "@spacebar/api/util/utility/profileBadges";
import { localProfileBadges } from "@spacebar/api/util/utility/remoteBadges";
import { User } from "@spacebar/database";

const router: Router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        description: "Reorder the badges on your profile and hide some of them. Staff badges always show first, and staff and pride badges can't be hidden.",
    }),
    async (req: Request, res: Response) => {
        const { user } = await loadBadgeOwner(req.user_id, req.user_id);
        const settings = mergeBadgeSettings(badgeSettings(user), await localProfileBadges(user), req.body ?? {});
        await User.setAccountPreferences(user.id, { badge_settings: settings });
        res.json(settings);
    },
);

export default router;
