import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Invite, PublicInviteRelation } from "@spacebar/database";
import { InviteListResponse } from "@spacebar/schemas/api/guilds/Invite";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            200: {
                body: "InviteListResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        const invites = await Invite.find({
            where: { guild_id },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])), // TODO cleanup
        });

        await Promise.all(
            invites
                .filter((i) => i.isExpired())
                .map(async (i) => {
                    await Invite.delete({ code: i.code });
                }),
        );

        return res.json(invites.filter((i) => !i.isExpired()).map((x) => x.toMetadataJSON()) satisfies InviteListResponse);
    },
);

export default router;
