import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { assertMaxLength, UserFieldCaps } from "@spacebar/util/util/UserFieldCaps";

const router = Router({ mergeParams: true });

router.post("/", route({}), async (req: Request, res: Response) => {
    const username = String(req.body?.username ?? "");
    assertMaxLength("username", username, UserFieldCaps.username);
    User.assertUsernameAllowed(username);
    res.json({
        taken: !User.isValidPomeloUsername(username) || (await User.isUsernameTaken(username, req.user_id)),
    });
});

export default router;
