import { Router, Request, Response } from "express";
import { Member } from "@spacebar/database";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id, role_id } = req.params as { [key: string]: string };

    await Member.IsInGuildOrFail(req.user_id, guild_id);

    // Does not return results for the @everyone role
    if (guild_id == role_id) return res.json([]);

    // TODO: Is this route really not paginated?
    const members = await Member.find({
        select: { index: true, id: true },
        where: {
            roles: {
                id: role_id,
            },
            guild_id,
        },
        take: 100,
    });

    return res.json(members.map((x) => x.id));
});

export default router;
