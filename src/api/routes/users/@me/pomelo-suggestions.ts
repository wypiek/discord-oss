import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: { id: true, username: true, global_name: true },
    });
    res.json({
        username: await User.suggestUsername(user.global_name || user.username, req.user_id),
    });
});

export default router;
