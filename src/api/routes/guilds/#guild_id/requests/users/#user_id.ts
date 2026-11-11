import { Request, Response, Router } from "express";
import { Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { GuildJoinRequest } from "@spacebar/database";
import { requireJoinRequestModerator } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id, user_id } = req.params as { [key: string]: string };
    const target = user_id === "@me" ? req.user_id : user_id;
    if (target !== req.user_id) await requireJoinRequestModerator(guild_id, req.user_id);
    const requests = await GuildJoinRequest.find({
        where: { guild_id, user_id: target, application_status: Not("STARTED") },
        relations: { user: true, actioned_by: true },
        order: { id: "DESC" },
    });
    res.json(requests.map((request) => request.toJSON(target === req.user_id ? "self" : "moderator")));
});

export default router;
