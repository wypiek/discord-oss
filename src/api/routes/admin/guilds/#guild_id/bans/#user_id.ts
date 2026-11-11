import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { assertCanActOnUser, banDeleteSeconds, banUser } from "@spacebar/api/util";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { AuditLog, Ban, Guild, User } from "@spacebar/database";
import { AuditLogEvents, BanCreateSchema } from "@spacebar/schemas";
import { emitEvent, GuildBanRemoveEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const loadGuild = async (req: Request) => {
    const guild = await Guild.findOne({ where: { id: req.params.guild_id as string }, select: { id: true, owner_id: true, federated_instance: true } });
    if (!guild) throw new HTTPError("Unknown server", 404);
    assertMirrorGuildEditable(guild);
    await assertCanActOnUser(req, req.params.user_id as string);
    return guild;
};

router.put(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "BanCreateSchema",
        description: "Ban an account from any server, removing it if it is a member and optionally deleting its recent messages",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const guild = await loadGuild(req);
        const user_id = req.params.user_id as string;
        const body = (req.body ?? {}) as BanCreateSchema;
        if (guild.owner_id === user_id) throw new HTTPError("Transfer the server to someone else before banning its owner", 400);
        if (user_id === req.user_id) throw new HTTPError("You can't ban yourself", 400);
        const reason = auditLogReason(req.headers["x-audit-log-reason"]) ?? body.reason?.trim();
        const banned = await banUser({
            guild_id: guild.id,
            user_id,
            executor_id: req.user_id,
            reason: reason || undefined,
            delete_message_seconds: banDeleteSeconds(body),
        });
        if (!banned) throw new HTTPError("This account is already banned from the server", 409);
        res.sendStatus(204);
    },
);

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Lift a ban in any server",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const guild = await loadGuild(req);
        const user_id = req.params.user_id as string;
        const ban = await Ban.findOne({ where: { guild_id: guild.id, user_id }, select: { id: true, user_id: true, executor_id: true } });
        if (!ban || ban.executor_id === user_id) throw new HTTPError("This account isn't banned from the server", 404);
        const user = await User.getPublicUser(user_id);
        await Ban.delete({ guild_id: guild.id, user_id });
        await Promise.all([
            AuditLog.log({
                guild_id: guild.id,
                user_id: req.user_id,
                action_type: AuditLogEvents.MEMBER_BAN_REMOVE,
                target_id: user_id,
                reason: auditLogReason(req.headers["x-audit-log-reason"]),
            }),
            emitEvent({ event: "GUILD_BAN_REMOVE", data: { guild_id: guild.id, user }, guild_id: guild.id } satisfies GuildBanRemoveEvent),
        ]);
        res.sendStatus(204);
    },
);

export default router;
