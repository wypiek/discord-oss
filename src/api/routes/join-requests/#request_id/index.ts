import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { findJoinRequest, openInterview, requireJoinRequestModerator, UNKNOWN_JOIN_REQUEST } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { request_id } = req.params as { [key: string]: string };
    const request = await findJoinRequest({ id: request_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    if (request.user_id === req.user_id) return res.json(request.toJSON("self"));
    await requireJoinRequestModerator(request.guild_id, req.user_id).catch(() => {
        throw UNKNOWN_JOIN_REQUEST;
    });
    res.json(request.toJSON("moderator"));
});

router.post("/interview", route({}), async (req: Request, res: Response) => {
    const { request_id } = req.params as { [key: string]: string };
    const request = await findJoinRequest({ id: request_id });
    if (!request) throw UNKNOWN_JOIN_REQUEST;
    await requireJoinRequestModerator(request.guild_id, req.user_id);
    res.json(await openInterview(request, req.user_id));
});

export default router;
