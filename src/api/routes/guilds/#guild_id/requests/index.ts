import { Request, Response, Router } from "express";
import { FindOptionsWhere, LessThan, MoreThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { GuildJoinRequest, GuildJoinRequestStatus } from "@spacebar/database";
import { GuildJoinRequestBulkActionSchema } from "@spacebar/schemas";
import { FieldErrors } from "@spacebar/util";
import { bulkActionJoinRequests } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const STATUSES: GuildJoinRequestStatus[] = ["SUBMITTED", "REJECTED", "APPROVED"];
const SNOWFLAKE = /^\d{1,20}$/;

router.get("/", route({ permission: "KICK_MEMBERS" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const { status = "SUBMITTED", before, after } = req.query as Record<string, string | undefined>;
    if (!STATUSES.includes(status as GuildJoinRequestStatus))
        throw FieldErrors({
            status: {
                code: "BASE_TYPE_CHOICES",
                message: `Value must be one of ${STATUSES.join(", ")}.`,
            },
        });
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 100);

    const base: FindOptionsWhere<GuildJoinRequest> = {
        guild_id,
        application_status: status as GuildJoinRequestStatus,
    };
    const where = {
        ...base,
        ...(before && SNOWFLAKE.test(before) && { id: LessThan(before) }),
        ...(after && SNOWFLAKE.test(after) && { id: MoreThan(after) }),
    };
    const [requests, total] = await Promise.all([
        GuildJoinRequest.find({
            where,
            relations: { user: true, actioned_by: true },
            order: { id: after ? "ASC" : "DESC" },
            take: limit,
        }),
        GuildJoinRequest.count({ where: base }),
    ]);
    res.json({
        guild_join_requests: requests.map((request) => request.toJSON("moderator")),
        total,
        limit,
    });
});

router.patch("/", route({ permission: "KICK_MEMBERS", requestBody: "GuildJoinRequestBulkActionSchema" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const { action } = req.body as GuildJoinRequestBulkActionSchema;
    await bulkActionJoinRequests(guild_id, req.user_id, action);
    res.sendStatus(204);
});

export default router;
