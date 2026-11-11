import bcrypt from "bcrypt";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { emitUserUpdate, passwordMismatch, requireMfa, setSmsFlag } from "@spacebar/api/util";
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
        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { id: true, data: true },
        });
        const { password } = req.body as { password?: string };
        if (!user.data?.hash) await requireMfa(req);
        else if (!(typeof password === "string" && (await bcrypt.compare(password, user.data.hash)))) throw passwordMismatch();

        if (await setSmsFlag(req.user_id, false)) await emitUserUpdate(req.user_id);
        res.sendStatus(204);
    },
);

export default router;
