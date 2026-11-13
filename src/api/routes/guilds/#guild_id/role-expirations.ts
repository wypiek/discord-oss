import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { MemberRoleExpiration } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { RoleExpirationsResponse } from "@spacebar/schemas";
import { FindOptionsWhere } from "typeorm";

const router: Router = Router({ mergeParams: true });
const SNOWFLAKE = /^\d{1,20}$/;

function snowflakeQuery(value: unknown, field: string) {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !SNOWFLAKE.test(value)) throw FieldErrors({ [field]: { code: "NUMBER_TYPE_COERCE", message: "Value is not snowflake." } });
    return value;
}

router.get(
    "/",
    route({
        permission: "MANAGE_ROLES",
        query: {
            user_id: {
                type: "string",
                description: "Only list the temporary roles of this member",
            },
            role_id: {
                type: "string",
                description: "Only list the members who have this role temporarily",
            },
            limit: {
                type: "number",
                description: "Max number of entries to return (1-1000, default 1000)",
            },
        },
        responses: {
            200: {
                body: "RoleExpirationsResponse",
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
        const limit = req.query.limit === undefined ? 1000 : Number(req.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw FieldErrors({ limit: { code: "NUMBER_TYPE_MAX", message: "Must be between 1 and 1000." } });
        const user_id = snowflakeQuery(req.query.user_id, "user_id");
        const role_id = snowflakeQuery(req.query.role_id, "role_id");
        const where: FindOptionsWhere<MemberRoleExpiration> = { guild_id };
        if (user_id) where.user_id = user_id;
        if (role_id) where.role_id = role_id;
        const rows = await MemberRoleExpiration.find({
            where,
            order: { expires_at: "ASC", user_id: "ASC", role_id: "ASC" },
            take: limit,
        });
        res.json(rows.map((row) => row.toJSON()) satisfies RoleExpirationsResponse);
    },
);

export default router;
