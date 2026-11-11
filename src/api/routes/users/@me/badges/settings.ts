import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { badgeSettings, mergeBadgeSettings } from "@spacebar/api/util/utility/badgeSettings";
import { loadBadgeOwner, localProfileBadges, normalizeBadgeSettings } from "@spacebar/api/util/utility/profileBadges";
import { User } from "@spacebar/database";

const router: Router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        description: "Reorder the badges on your profile and hide some of them. Staff badges always show first.",
    }),
    async (req: Request, res: Response) => {
        const { user } = await loadBadgeOwner(req.user_id, req.user_id);
        const badges = await localProfileBadges(user);
        const settings = mergeBadgeSettings(
            normalizeBadgeSettings(badgeSettings(user), badges),
            badges.map((badge) => ({ id: badge.settings_id })),
            req.body ?? {},
        );
        await User.setAccountPreferences(user.id, { badge_settings: settings });
        res.json(settings);
    },
);

export default router;
