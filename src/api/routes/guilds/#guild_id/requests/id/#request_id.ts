import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GuildJoinRequestActionSchema } from "@spacebar/schemas";
import { actionJoinRequest, findJoinRequest, UNKNOWN_JOIN_REQUEST } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.patch("/", route({ permission: "KICK_MEMBERS", requestBody: "GuildJoinRequestActionSchema" }), async (req: Request, res: Response) => {
    const { guild_id, request_id } = req.params as { [key: string]: string };
    const { action, rejection_reason } = req.body as GuildJoinRequestActionSchema;
    const request = await findJoinRequest({ guild_id, id: request_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    res.json((await actionJoinRequest(request, req.user_id, action, rejection_reason)).toJSON("moderator"));
});

export default router;
