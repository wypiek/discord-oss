import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { badgeDirectory, loadBadgeOwner } from "@spacebar/api/util/utility/profileBadges";
import { viewerSeesFullProfile } from "@spacebar/api/util/utility/profilePrivacy";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        description:
            "The profile badges a user owns, in their display order. Your own list also has the badges you hid, marked hidden. Empty when the user's private profile hides it from you.",
    }),
    async (req: Request, res: Response) => {
        const { user, self } = await loadBadgeOwner(req.params.user_id as string, req.user_id);
        if (!(await viewerSeesFullProfile(user.id, req.user_id, req.rights))) return res.json({ badges: [] });
        res.json({ badges: await badgeDirectory(user, self) });
    },
);

export default router;
