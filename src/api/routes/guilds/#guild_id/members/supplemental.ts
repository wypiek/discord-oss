import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            200: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const user_ids = ((req.body?.user_ids as string[]) ?? []).slice(0, 200);
        if (!user_ids.length) return res.json([]);

        const members = await Member.find({
            where: { guild_id, id: In(user_ids) },
            select: { id: true },
        });
        res.json(
            members.map(({ id }) => ({
                user_id: id,
                source_invite_code: null,
                join_source_type: 0,
                inviter_id: null,
                integration_type: null,
            })),
        );
    },
);

export default router;
