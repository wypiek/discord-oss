import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { PublicMemberProjection, PublicUserProjection } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        oauth2: ["guilds.members.read"],
        description: "Get the current user's member object in a guild",
        responses: {
            200: { body: "PublicMember" },
            404: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const member = await Member.findOne({
            where: { id: req.user_id, guild_id },
            relations: { roles: true, user: true },
            select: {
                index: true,
                ...Object.fromEntries(PublicMemberProjection.map((x) => [x, true])),
                user: Object.fromEntries(PublicUserProjection.map((x) => [x, true])),
                roles: { id: true },
            },
        });
        if (!member) throw DiscordApiErrors.UNKNOWN_GUILD;
        res.json({
            ...member.toPublicMember(),
            user: member.user.toPublicUser(),
            roles: member.roles.map((x) => x.id).filter((id) => id !== guild_id),
        });
    },
);

export default router;
