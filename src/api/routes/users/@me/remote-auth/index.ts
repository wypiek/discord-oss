import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ResponseError, signTicket } from "@spacebar/api/util";
import { User } from "@spacebar/database";
import { EVENT, Event, emitEvent } from "@spacebar/util";

export const emitRemoteAuth = (fingerprint: string, event: string, data: Record<string, unknown> = {}) =>
    emitEvent({ session_id: `remote-auth:${fingerprint}`, event: event as EVENT, data } as Event);

const router = Router({ mergeParams: true });

router.post("/", route({ spacebarOnly: false }), async (req: Request, res: Response) => {
    const { fingerprint } = req.body as { fingerprint?: string };
    if (typeof fingerprint !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) throw new ResponseError(400, { message: "Invalid remote auth fingerprint", code: 10061 });

    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: { id: true, username: true, discriminator: true, avatar: true },
    });
    await emitRemoteAuth(fingerprint, "REMOTE_AUTH_PENDING_TICKET", {
        user: `${user.id}:${user.discriminator}:${user.avatar ?? "0"}:${user.username}`,
    });

    res.json({
        handshake_token: signTicket({ typ: "ra_handshake", uid: user.id, fp: fingerprint }, 300),
    });
});

export default router;
