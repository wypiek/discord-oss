import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { recent_avatars } = await User.findOneOrFail({
        where: { id: req.user_id },
        select: { id: true, recent_avatars: true },
    });
    res.json({ avatars: recent_avatars ?? [] });
});

router.delete("/:avatar_id", route({ responses: { 204: {} } }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: { id: true, recent_avatars: true },
    });
    await User.update({ id: req.user_id }, { recent_avatars: (user.recent_avatars ?? []).filter((x) => x.id !== req.params.avatar_id) });
    res.sendStatus(204);
});

export default router;
