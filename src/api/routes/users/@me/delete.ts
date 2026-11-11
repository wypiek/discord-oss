import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ResponseError, requireAccountPassword, revokeSessions } from "@spacebar/api/util";
import { Guild, User } from "@spacebar/database";

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

        if (await Guild.exists({ where: { owner_id: req.user_id } }))
            throw new ResponseError(400, {
                message: "You must transfer ownership of any owned servers before deleting your account.",
                code: 40011,
            });

        await User.update({ id: req.user_id }, { deleted: true });
        res.sendStatus(204);
        await revokeSessions(req.user_id);
    },
);

export default router;
