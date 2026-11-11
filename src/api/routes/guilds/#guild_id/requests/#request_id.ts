import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GuildJoinRequestActionSchema } from "@spacebar/schemas";
import { DiscordApiErrors } from "@spacebar/util";
import { ackJoinRequest, actionJoinRequest, findJoinRequest, UNKNOWN_JOIN_REQUEST } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.patch("/", route({ permission: "KICK_MEMBERS", requestBody: "GuildJoinRequestActionSchema" }), async (req: Request, res: Response) => {
    const { guild_id, request_id } = req.params as { [key: string]: string };
    const { action, rejection_reason } = req.body as GuildJoinRequestActionSchema;
    const request = (await findJoinRequest({ guild_id, id: request_id })) ?? (await findJoinRequest({ guild_id, user_id: request_id }));
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    res.json((await actionJoinRequest(request, req.user_id, action, rejection_reason)).toJSON("moderator"));
});

router.post("/ack", route({}), async (req: Request, res: Response) => {
    const { guild_id, request_id } = req.params as { [key: string]: string };
    if (request_id !== req.user_id) {
        const request = await findJoinRequest({ guild_id, id: request_id });
        if (!request) throw UNKNOWN_JOIN_REQUEST;
        if (request.user_id !== req.user_id) throw DiscordApiErrors.MISSING_PERMISSIONS;
    }
    await ackJoinRequest(guild_id, req.user_id);
    res.sendStatus(204);
});

export default router;
