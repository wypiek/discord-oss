import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { AuditLog, Guild, Invite } from "@spacebar/database";
import { AuditLogEvents } from "@spacebar/schemas";
import { emitEvent, InviteDeleteEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Revoke an invite of any server. The vanity link can't be revoked here",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        const code = req.params.code as string;
        assertMirrorGuildEditable(await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, federated_instance: true } }));
        const invite = await Invite.findOne({ where: { code, guild_id } });
        if (!invite) throw new HTTPError("This server has no invite with that code", 404);
        if (invite.vanity_url) throw new HTTPError("The vanity link belongs to the server's settings, so its owner changes it there", 400);
        await Invite.delete({ code, guild_id });
        await Promise.all([
            AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.INVITE_DELETE,
                changes: AuditLog.diff(invite, {}, ["code", "channel_id", "inviter_id", "uses", "max_uses", "max_age", "temporary", "flags"]),
                reason: auditLogReason(req.headers["x-audit-log-reason"]),
            }),
            emitEvent({ event: "INVITE_DELETE", guild_id, data: { channel_id: invite.channel_id, guild_id, code } } satisfies InviteDeleteEvent),
        ]);
        res.sendStatus(204);
    },
);

export default router;
