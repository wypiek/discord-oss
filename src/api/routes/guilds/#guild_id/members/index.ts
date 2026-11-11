import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { MoreThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { PublicMemberProjection, PublicUserProjection } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

// TODO: send over websocket
// TODO: check for GUILD_MEMBERS intent

router.get(
    "/",
    route({
        query: {
            limit: {
                type: "number",
                description: "max number of members to return (1-1000). default 1",
            },
            after: {
                type: "string",
            },
        },
        responses: {
            200: {
                body: "PublicMemberListResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const limit = Number(req.query.limit) || 1;
        if (limit > 1000 || limit < 1) throw new HTTPError("Limit must be between 1 and 1000");
        const after = typeof req.query.after === "string" && /^\d+$/.test(req.query.after) ? req.query.after : "0";

        await Member.IsInGuildOrFail(req.user_id, guild_id);

        const members = await Member.attachRoles(
            await Member.find({
                where: { guild_id, id: MoreThan(after) },
                relations: { user: true },
                select: {
                    index: true,
                    ...Object.fromEntries(PublicMemberProjection.filter((x) => x !== "roles").map((x) => [x, true])),
                    user: Object.fromEntries(PublicUserProjection.map((x) => [x, true])),
                },
                take: limit,
                order: { id: "ASC" },
            }),
        );

        return res.json(
            members.map((m) => ({
                ...m.toPublicMember(),
                user: m.user.toPublicUser(),
                roles: m.roles.map((x) => x.id).filter((id) => id !== guild_id),
            })),
        );
    },
);

export default router;
