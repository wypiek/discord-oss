import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "WhoAmIResponse",
            },
        },
        spacebarOnly: true,
    }),
    /*
            interface Request {
            user_id: string;
            user_bot: boolean;
            tokenData: UserTokenData;
            token: { id: string; iat: number; ver?: number; did?: string };
            user: User;
            session?: Session;
            rights: Rights;
            fingerprint?: string;
        }
     */
    async (req: Request, res: Response) => {
        res.json({
            id: req.user_id,
            device_id: req.session?.session_id ?? null,
            flags: req.user?.flags ?? 0,
            rights: req.user?.rights ?? 0,
            logged_in_since: new Date(req.token.iat).toISOString(),
        });
    },
);

export default router;
