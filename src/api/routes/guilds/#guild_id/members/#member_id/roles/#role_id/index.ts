import { authorizeMemberRoleChanges } from "@spacebar/api/util/utility/memberRoleAuthorization";
import { route } from "@spacebar/api/middlewares";
import { AuditLog, Member, Role } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { AuditLogEvents } from "@spacebar/schemas";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.delete(
    "/",
    route({
        permission: "MANAGE_ROLES",
        responses: {
            204: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, role_id } = req.params as { [key: string]: string };
        const member_id = req.params.member_id === "@me" ? req.user_id : (req.params.member_id as string);

        if (role_id === guild_id) throw DiscordApiErrors.MISSING_PERMISSIONS;
        await authorizeMemberRoleChanges(req.user_id, guild_id, [role_id], []);
        await Member.removeRole(member_id, guild_id, role_id);
        const role = await Role.findOne({
            where: { id: role_id, guild_id },
            select: { id: true, name: true },
        });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.MEMBER_ROLE_UPDATE,
            target_id: member_id,
            changes: [{ key: "$remove", new_value: [{ id: role_id, name: role?.name }] }] as unknown as AuditLog["changes"],
            reason: req.headers["x-audit-log-reason"],
        });
        res.sendStatus(204);
    },
);

router.put(
    "/",
    route({
        permission: "MANAGE_ROLES",
        responses: {
            204: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, role_id } = req.params as { [key: string]: string };
        const member_id = req.params.member_id === "@me" ? req.user_id : (req.params.member_id as string);

        if (role_id === guild_id) throw DiscordApiErrors.MISSING_PERMISSIONS;
        await authorizeMemberRoleChanges(req.user_id, guild_id, [], [role_id]);
        await Member.addRole(member_id, guild_id, role_id);
        const role = await Role.findOne({
            where: { id: role_id, guild_id },
            select: { id: true, name: true },
        });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.MEMBER_ROLE_UPDATE,
            target_id: member_id,
            changes: [{ key: "$add", new_value: [{ id: role_id, name: role?.name }] }] as unknown as AuditLog["changes"],
            reason: req.headers["x-audit-log-reason"],
        });
        res.sendStatus(204);
    },
);

export default router;
