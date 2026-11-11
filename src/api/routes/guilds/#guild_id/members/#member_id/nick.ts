import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { assertOutranks } from "@spacebar/api/util";
import { Member } from "@spacebar/database";
import { getPermission } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        requestBody: "MemberNickChangeSchema",
        responses: {
            200: {
                body: "PublicMember",
            },
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const member_id = req.params.member_id === "@me" ? req.user_id : (req.params.member_id as string);

        const perms = await getPermission(req.user_id, guild_id);
        if (member_id === req.user_id) perms.hasThrow("CHANGE_NICKNAME");
        else {
            perms.hasThrow("MANAGE_NICKNAMES");
            await assertOutranks(guild_id, req.user_id, member_id);
        }

        await Member.changeNickname(member_id, guild_id, req.body.nick);

        const member = await Member.findOne({
            where: { id: member_id, guild_id },
            relations: { roles: true },
        });

        res.send(member?.toPublicMember());
    },
);

export default router;
