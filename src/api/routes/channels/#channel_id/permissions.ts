import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { assertOverwriteChanges } from "@spacebar/api/util";
import { AuditLog, Channel, Member, Role } from "@spacebar/database";
import { ChannelUpdateEvent, emitEvent } from "@spacebar/util";
import { AuditLogEvents, ChannelPermissionOverwriteSchema, ChannelPermissionOverwrite, ChannelPermissionOverwriteType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.put(
    "/:overwrite_id",
    route({
        requestBody: "ChannelPermissionOverwriteSchema",
        permission: "MANAGE_ROLES",
        responses: {
            204: {},
            404: {},
            501: {},
            400: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, overwrite_id } = req.params as { [key: string]: string };
        const body = req.body as ChannelPermissionOverwriteSchema;

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
        });
        if (!channel.guild_id) throw new HTTPError("Channel not found", 404);
        channel.position = await Channel.calculatePosition(channel_id, channel.guild_id, channel.guild);

        if (body.type === ChannelPermissionOverwriteType.role) {
            if (!(await Role.count({ where: { id: overwrite_id, guild_id: channel.guild_id } }))) throw new HTTPError("role not found", 404);
        } else if (body.type === ChannelPermissionOverwriteType.member) {
            if (!(await Member.count({ where: { id: overwrite_id, guild_id: channel.guild_id } }))) throw new HTTPError("user not found", 404);
        } else throw new HTTPError("type not supported", 501);

        const requested = { id: overwrite_id, allow: String(body.allow || "0"), deny: String(body.deny || "0") };
        assertOverwriteChanges(req.permission!, channel.permission_overwrites, [...(channel.permission_overwrites ?? []).filter((x) => x.id !== overwrite_id), requested], true);
        let overwrite: ChannelPermissionOverwrite | undefined = channel.permission_overwrites?.find((x) => x.id === overwrite_id);
        const before = overwrite ? { ...overwrite } : undefined;
        if (!overwrite) {
            overwrite = {
                id: overwrite_id,
                type: body.type,
                allow: "0",
                deny: "0",
            };
            channel.permission_overwrites?.push(overwrite);
        }
        overwrite.allow = String(BigInt(requested.allow));
        overwrite.deny = String(BigInt(requested.deny));

        await Promise.all([
            channel.save(),
            emitEvent({
                event: "CHANNEL_UPDATE",
                channel_id,
                data: channel.toJSON(),
            } satisfies ChannelUpdateEvent),
            AuditLog.log({
                guild_id: channel.guild_id,
                user_id: req.user_id,
                action_type: before ? AuditLogEvents.CHANNEL_OVERWRITE_UPDATE : AuditLogEvents.CHANNEL_OVERWRITE_CREATE,
                target_id: channel_id,
                changes: before ? AuditLog.diff(before, overwrite, ["allow", "deny"]) : AuditLog.diff({}, overwrite, ["id", "type", "allow", "deny"]),
                options: { id: overwrite_id, type: String(overwrite.type) },
                reason: req.headers["x-audit-log-reason"],
            }),
        ]);

        return res.sendStatus(204);
    },
);

router.delete("/:overwrite_id", route({ permission: "MANAGE_ROLES", responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    const { channel_id, overwrite_id } = req.params as { [key: string]: string };

    const channel = await Channel.findOneOrFail({
        where: { id: channel_id },
    });
    if (!channel.guild_id) throw new HTTPError("Channel not found", 404);

    const removed = channel.permission_overwrites?.find((x) => x.id === overwrite_id);
    assertOverwriteChanges(req.permission!, channel.permission_overwrites, channel.permission_overwrites?.filter((x) => x.id !== overwrite_id) ?? [], true);
    channel.permission_overwrites = channel.permission_overwrites?.filter((x) => x.id !== overwrite_id);
    if (removed)
        await AuditLog.log({
            guild_id: channel.guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.CHANNEL_OVERWRITE_DELETE,
            target_id: channel_id,
            changes: AuditLog.diff(removed, {}, ["id", "type", "allow", "deny"]),
            options: { id: overwrite_id, type: String(removed.type) },
            reason: req.headers["x-audit-log-reason"],
        });

    await Promise.all([
        channel.save(),
        emitEvent({
            event: "CHANNEL_UPDATE",
            channel_id,
            data: channel.toJSON(),
        } satisfies ChannelUpdateEvent),
    ]);

    return res.sendStatus(204);
});

export default router;
