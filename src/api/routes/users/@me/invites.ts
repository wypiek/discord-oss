import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { createFriendInvite, listFriendInvites, revokeFriendInvites } from "@spacebar/api/util";
import { DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json((await listFriendInvites(req.user_id)).map((invite) => invite.toMetadataJSON()));
});

router.post("/", route({}), async (req: Request, res: Response) => {
    if (req.user_bot) throw DiscordApiErrors.BOT_PROHIBITED_ENDPOINT;
    res.json((await createFriendInvite(req.user_id)).toMetadataJSON());
});

router.delete("/", route({}), async (req: Request, res: Response) => {
    res.json((await revokeFriendInvites(req.user_id)).map((invite) => invite.toMetadataJSON()));
});

export default router;
