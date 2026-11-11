import { assertRoleEditable, assertRolePosition, authorizeRolePermissions, getRoleAuthority } from "@spacebar/api/util/utility/roleAuthorization";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Member, Role } from "@spacebar/database";
import { emitEvent, GuildRoleDeleteEvent, GuildRoleUpdateEvent, handleFile } from "@spacebar/util";
import { AuditLogEvents, RoleModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "Role",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, role_id } = req.params as { [key: string]: string };
        await Member.IsInGuildOrFail(req.user_id, guild_id);
        const role = await Role.findOneOrFail({
            where: { guild_id, id: role_id },
        });
        return res.json(role);
    },
);

router.delete(
    "/",
    route({
        permission: "MANAGE_ROLES",
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, role_id } = req.params as { [key: string]: string };
        if (role_id === guild_id) throw new HTTPError("You can't delete the @everyone role");
        const deleted = await Role.findOneOrFail({ where: { id: role_id, guild_id } });
        assertRoleEditable(await getRoleAuthority(req.user_id, guild_id), deleted);

        await Promise.all([
            AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.ROLE_DELETE,
                target_id: role_id,
                changes: AuditLog.diff(deleted, {}, ["name", "permissions", "color", "colors", "hoist", "mentionable"]),
                reason: req.headers["x-audit-log-reason"],
            }),
            Role.delete({
                id: role_id,
                guild_id: guild_id,
            }),
            emitEvent({
                event: "GUILD_ROLE_DELETE",
                guild_id,
                data: {
                    guild_id,
                    role_id,
                },
            } satisfies GuildRoleDeleteEvent),
        ]);

        res.sendStatus(204);
    },
);

router.patch(
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
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { role_id, guild_id } = req.params as { [key: string]: string };
        const body = req.body as RoleModifySchema;

        const role = await Role.findOneOrFail({
            where: { id: role_id, guild: { id: guild_id } },
        });

        const authority = await getRoleAuthority(req.user_id, guild_id);
        assertRoleEditable(authority, role, true);
        if (body.position !== undefined && body.position !== role.position) {
            assertRoleEditable(authority, role);
            assertRolePosition(authority, body.position);
        }
        const grantedPermissions = body.permissions === undefined ? undefined : authorizeRolePermissions(authority, body.permissions, role.permissions);

        const keys = ["name", "permissions", "color", "colors", "hoist", "mentionable", "icon", "unicode_emoji"] as const;
        const before = Object.fromEntries(keys.map((key) => [key, role[key]]));
        const { icon, unicode_emoji, permissions, color, colors, ...rest } = body;
        role.assign(rest);
        if (permissions !== undefined) role.permissions = grantedPermissions!;
        if (icon !== undefined) Object.assign(role, { icon: icon ? await handleFile(`/role-icons/${role_id}`, icon) : null });
        if (unicode_emoji !== undefined) Object.assign(role, { unicode_emoji: unicode_emoji || null });
        if (colors) {
            const primary_color = colors.primary_color ?? 0;
            Object.assign(role, {
                color: primary_color,
                colors: {
                    primary_color,
                    secondary_color: colors.secondary_color ?? undefined,
                    tertiary_color: colors.tertiary_color ?? undefined,
                },
            });
        } else if (color !== undefined) Object.assign(role, { color, colors: { primary_color: color } });

        const changes = AuditLog.diff(before, role, [...keys]);
        await Promise.all([
            role.save(),
            changes.length &&
                AuditLog.log({
                    guild_id,
                    user_id: req.user_id,
                    action_type: AuditLogEvents.ROLE_UPDATE,
                    target_id: role_id,
                    changes,
                    reason: req.headers["x-audit-log-reason"],
                }),
            emitEvent({
                event: "GUILD_ROLE_UPDATE",
                guild_id,
                data: {
                    guild_id,
                    role,
                },
            } satisfies GuildRoleUpdateEvent),
        ]);

        res.json(role);
    },
);

export default router;
