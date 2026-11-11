import { createHash } from "node:crypto";
import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { revokeStaleE2eeDevices } from "@spacebar/api/util";
import { emitEvent } from "@spacebar/util";
import { SessionsLogoutSchema } from "@spacebar/schemas";
import { Session } from "@spacebar/database";

const router = Router({ mergeParams: true });
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GetSessionsResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { extended = false } = req.query;
        const sessions = (await Session.find({
            where: { user_id: req.user_id, is_admin_session: false },
        })) as Session[];

        res.json({
            user_sessions: sessions.map((session) => (extended ? session.getExtendedDeviceInfo() : session.getDiscordDeviceInfo())),
        });
    },
);

router.post(
    "/logout",
    route({
        requestBody: "SessionsLogoutSchema",
        responses: {
            204: {},
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as SessionsLogoutSchema;

        let sessions: Session[] = [];
        if ("session_ids" in body) {
            sessions = (await Session.find({
                where: { user_id: req.user_id, session_id: In(body.session_ids!) },
            })) as Session[];
        }

        if ("session_id_hashes" in body) {
            const allSessions = (await Session.find({ where: { user_id: req.user_id } })) as Session[];
            const hashSet = new Set(body.session_id_hashes);
            const matchingSessions = allSessions.filter((session) => {
                const hash = createHash("sha256").update(session.session_id).digest("hex");
                return hashSet.has(hash);
            });
            sessions.push(...matchingSessions);
        }

        for (const session of sessions) {
            await emitEvent({
                session_id: session.session_id,
                event: "SB_SESSION_REMOVE",
                origin: "Sessions logout",
            });
            await Session.delete({ session_id: session.session_id });
        }
        if (sessions.length) await revokeStaleE2eeDevices(req.user_id);
        res.status(204).send();
    },
);

export default router;
