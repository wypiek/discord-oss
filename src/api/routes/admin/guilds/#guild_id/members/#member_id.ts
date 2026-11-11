import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { assertCanActOnUser } from "@spacebar/api/util";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { AuditLog, Guild, Member, Role, VoiceChannels } from "@spacebar/database";
import { AdminGuildMemberUpdateSchema, AuditLogEvents } from "@spacebar/schemas";
import { emitEvent, GuildMemberUpdateEvent, Permissions } from "@spacebar/util";

const router = Router({ mergeParams: true });
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

const loadTarget = async (req: Request) => {
    const guild_id = req.params.guild_id as string;
    const member_id = req.params.member_id as string;
    const guild = await Guild.findOne({ where: { id: guild_id }, select: { id: true, owner_id: true, federated_instance: true } });
    if (!guild) throw new HTTPError("Unknown server", 404);
    assertMirrorGuildEditable(guild);
    const member = await Member.findOne({ where: { id: member_id, guild_id }, relations: { roles: true, user: true } });
    if (!member) throw new HTTPError("This account isn't a member of the server", 404);
    await assertCanActOnUser(req, member_id);
    return { guild, member, guild_id, member_id };
};

router.patch(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "AdminGuildMemberUpdateSchema",
        description: "Change a member's nickname, roles or timeout in any server",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminGuildMemberUpdateSchema;
        const { guild, member, guild_id, member_id } = await loadTarget(req);
        const reason = auditLogReason(req.headers["x-audit-log-reason"]);
        const before = {
            nick: member.nick ?? null,
            communication_disabled_until: member.communication_disabled_until?.toISOString() ?? null,
        };
        const rolesBefore = member.roles.map((role) => role.id).filter((id) => id !== guild_id);

        if (body.nick !== undefined) member.nick = body.nick?.trim() || undefined;

        if (body.roles !== undefined) {
            const requested = [...new Set(body.roles.filter((id) => id !== guild_id))];
            const roles = await Role.find({ where: { guild_id, id: In([...new Set([...requested, ...rolesBefore, guild_id])]) } });
            const byId = new Map(roles.map((role) => [role.id, role]));
            const missing = requested.filter((id) => !byId.has(id));
            if (missing.length) throw new HTTPError(`These roles aren't in the server: ${missing.join(", ")}`, 400);
            const changed = [...requested.filter((id) => !rolesBefore.includes(id)), ...rolesBefore.filter((id) => !requested.includes(id))];
            if (changed.some((id) => byId.get(id)?.managed)) throw new HTTPError("Integration-managed roles must be changed through their integration", 400);
            member.roles = [...requested, guild_id].map((id) => byId.get(id)).filter((role): role is Role => !!role);
        }

        if (body.communication_disabled_until !== undefined) {
            const until = body.communication_disabled_until === null ? null : new Date(body.communication_disabled_until);
            if (until && Number.isNaN(until.getTime())) throw new HTTPError("communication_disabled_until must be a date", 400);
            if (until && until.getTime() > Date.now() + MAX_TIMEOUT_MS + 60_000) throw new HTTPError("Timeouts can last at most 28 days", 400);
            if (until && until.getTime() > Date.now()) {
                if (guild.owner_id === member_id) throw new HTTPError("The server owner can't be timed out", 400);
                const permissions = Permissions.rolePermission(member.roles);
                if ((permissions & Permissions.FLAGS.ADMINISTRATOR) === Permissions.FLAGS.ADMINISTRATOR)
                    throw new HTTPError("Members with the Administrator permission ignore timeouts. Remove the role that grants it first", 400);
            }
            member.communication_disabled_until = until && until.getTime() > Date.now() ? until : null;
        }

        await member.save();
        if (member.communication_disabled_until) await VoiceChannels.move(guild_id, member_id, null).catch(() => undefined);

        const roles = member.roles.map((role) => role.id).filter((id) => id !== guild_id);
        await emitEvent({
            event: "GUILD_MEMBER_UPDATE",
            guild_id,
            data: { ...member.toPublicMember(), guild_id, user: member.user.toPublicUser(), roles },
        } satisfies GuildMemberUpdateEvent);

        const after = {
            nick: member.nick ?? null,
            communication_disabled_until: member.communication_disabled_until?.toISOString() ?? null,
        };
        const changes = AuditLog.diff(before, after, ["nick", "communication_disabled_until"]);
        if (changes.length) await AuditLog.log({ guild_id, user_id: req.user_id, action_type: AuditLogEvents.MEMBER_UPDATE, target_id: member_id, changes, reason });
        const added = roles.filter((id) => !rolesBefore.includes(id));
        const removed = rolesBefore.filter((id) => !roles.includes(id));
        if (added.length || removed.length) {
            const names = new Map((await Role.find({ where: { guild_id, id: In([...added, ...removed]) }, select: { id: true, name: true } })).map((role) => [role.id, role.name]));
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.MEMBER_ROLE_UPDATE,
                target_id: member_id,
                changes: [
                    ...(added.length ? [{ key: "$add", new_value: added.map((id) => ({ id, name: names.get(id) })) }] : []),
                    ...(removed.length ? [{ key: "$remove", new_value: removed.map((id) => ({ id, name: names.get(id) })) }] : []),
                ] as unknown as AuditLog["changes"],
                reason,
            });
        }

        res.json({ id: member_id, nick: after.nick, roles, communication_disabled_until: after.communication_disabled_until });
    },
);

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Remove a member from any server. They can join again with an invite",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const { guild, guild_id, member_id } = await loadTarget(req);
        if (guild.owner_id === member_id) throw new HTTPError("Transfer the server to someone else before removing its owner", 400);
        await Member.removeFromGuild(member_id, guild_id);
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.MEMBER_KICK,
            target_id: member_id,
            reason: auditLogReason(req.headers["x-audit-log-reason"]),
        });
        res.sendStatus(204);
    },
);

export default router;
