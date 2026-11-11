import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { assertMaxLength } from "@spacebar/api/util/utility/inputCaps";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post("/", route({ authentication: "never" }), async (req: Request, res: Response) => {
    assertMaxLength("username", req.body?.username, 32);
    const username = String(req.body?.username ?? "");
    User.assertUsernameAllowed(username);
    res.json({
        taken: !User.isValidPomeloUsername(username) || (await User.isUsernameTaken(username)),
    });
});

export default router;
