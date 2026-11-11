import { assertRolePosition, authorizeRolePermissions, authorizeRolePositions, getRoleAuthority } from "@spacebar/api/util/utility/roleAuthorization";
import { Request, Response, Router } from "express";
import { In, Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Member, Role } from "@spacebar/database";
import { Config, DiscordApiErrors, emitEvent, GuildRoleCreateEvent, GuildRoleUpdateEvent, handleFile, Snowflake } from "@spacebar/util";
import { AuditLogEvents, RoleModifySchema, RolePositionUpdateSchema } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const guild_id = req.params.guild_id as string;

    await Member.IsInGuildOrFail(req.user_id, guild_id);

    const roles = await Role.find({ where: { guild_id: guild_id } });

    return res.json(roles);
});

router.post(
    "/",
    route({
        requestBody: "RoleModifySchema",
        permission: "MANAGE_ROLES",
        responses: {
            200: {
                body: "Role",
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
        const guild_id = req.params.guild_id as string;
        const body = req.body as RoleModifySchema;

        const authority = await getRoleAuthority(req.user_id, guild_id);
        const position = body.position ?? 1;
        assertRolePosition(authority, position, true);
        const role_count = await Role.count({ where: { guild_id } });
        const { maxRoles } = Config.get().limits.guild;

        if (role_count >= maxRoles) throw DiscordApiErrors.MAXIMUM_ROLES.withParams(maxRoles);

        const everyoneRole = await Role.findOne({ where: { id: guild_id, guild_id } });

        const role_id = Snowflake.generate();
        const role = Role.create({
            // values before ...body are default and can be overridden
            hoist: false,
            mentionable: false,
            ...body,
            position,
            guild_id: guild_id,
            managed: false,
            permissions: authorizeRolePermissions(authority, body.permissions ?? everyoneRole?.permissions ?? "0"),
            tags: undefined,
            icon: body.icon ? await handleFile(`/role-icons/${role_id}`, body.icon) : undefined,
            unicode_emoji: body.unicode_emoji || undefined,
            id: role_id,
            color: body.colors?.primary_color || body.color || 0,
            colors: {
                primary_color: body.colors?.primary_color || body.color || 0,
                secondary_color: body.colors?.secondary_color || undefined, // gradient
                tertiary_color: body.colors?.tertiary_color || undefined, // "holographic"
            },
        });

        await Promise.all([
            role.save(),
            // Move all existing roles up one position, to accommodate the new role
            Role.createQueryBuilder("roles")
                .where({
                    guild: { id: guild_id },
                    name: Not("@everyone"),
                    id: Not(role.id),
                })
                .update({ position: () => "position + 1" })
                .execute(),
            AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.ROLE_CREATE,
                target_id: role.id,
                changes: AuditLog.diff({}, role, ["name", "permissions", "color", "colors", "hoist", "mentionable", "icon", "unicode_emoji"]),
                reason: req.headers["x-audit-log-reason"],
            }),
            emitEvent({
                event: "GUILD_ROLE_CREATE",
                guild_id,
                data: {
                    guild_id,
                    role: role,
                },
            } satisfies GuildRoleCreateEvent),
        ]);

        res.json(role);
    },
);

router.patch(
    "/",
    route({
        requestBody: "RolePositionUpdateSchema",
        permission: "MANAGE_ROLES",
        responses: {
            200: {
                body: "RoleListResponse",
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
        const body = req.body as RolePositionUpdateSchema;

        await authorizeRolePositions(req.user_id, guild_id, body);
        await Promise.all(body.map(async (x) => Role.update({ guild_id, id: x.id }, { position: x.position })));

        const roles = body.length ? await Role.find({ where: { id: In(body.map((x) => x.id)), guild_id } }) : [];

        res.json(await Role.find({ where: { guild_id }, order: { position: "ASC" } }));

        await Promise.all(
            roles.map((x) =>
                emitEvent({
                    event: "GUILD_ROLE_UPDATE",
                    guild_id,
                    data: {
                        guild_id,
                        role: x,
                    },
                } satisfies GuildRoleUpdateEvent),
            ),
        );
    },
);

export default router;
