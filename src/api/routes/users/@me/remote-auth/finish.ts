import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ResponseError, readTicket } from "@spacebar/api/util";
import { emitRemoteAuth } from "./index";

export const readHandshake = (req: Request) => {
    const decoded = readTicket<{ typ: string; uid?: string; fp?: string }>(req.body?.handshake_token, "ra_handshake");
    if (!decoded?.fp || decoded.uid !== req.user_id) throw new ResponseError(400, { message: "Invalid remote auth handshake token", code: 10061 });
    return decoded.fp;
};

const router = Router({ mergeParams: true });

router.post("/", route({ spacebarOnly: false }), async (req: Request, res: Response) => {
    await emitRemoteAuth(readHandshake(req), "REMOTE_AUTH_PENDING_LOGIN", { user_id: req.user_id });
    res.sendStatus(204);
});

export default router;
