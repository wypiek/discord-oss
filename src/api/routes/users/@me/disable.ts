import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { requireAccountPassword, revokeSessions } from "@spacebar/api/util";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        await requireAccountPassword(req);
        await User.update({ id: req.user_id }, { disabled: true });
        res.sendStatus(204);
        await revokeSessions(req.user_id);
    },
);

export default router;
