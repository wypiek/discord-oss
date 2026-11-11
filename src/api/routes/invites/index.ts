import { route } from "@spacebar/api/middlewares";
import { APPLICATION_BYPASS_INVITE_FLAG, acceptFriendInvite, isApplyGuild, onGuildMemberJoin, startJoinRequest } from "@spacebar/api/util";
import { AuditLog, Ban, Channel, Guild, GuildScheduledEvent, Invite, Member, PublicInviteRelation, Recipient, Role, ScheduledEvents, User } from "@spacebar/database";
import { ChannelRecipientAddEvent, Config, DiscordApiErrors, DmChannelDTO, emitEvent, getPermission, InviteDeleteEvent, Permissions } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { AuditLogEvents, ChannelPermissionOverwriteType, ChannelType, MessageType, UserFlags } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

async function joinGroupDm(found: Invite, user_id: string) {
    if (found.isExpired()) {
        await Invite.delete({ code: found.code });
        throw DiscordApiErrors.UNKNOWN_INVITE;
    }
    const channel = await Channel.findOne({
        where: { id: found.channel_id },
        relations: { recipients: true },
    });
    if (!channel || channel.type !== ChannelType.GROUP_DM) throw DiscordApiErrors.UNKNOWN_INVITE;

    let new_member = false;
    const existing = channel.recipients?.find((r) => r.user_id === user_id);
    if (!existing) {
        const { maxGroupDmRecipients } = Config.get().limits.channel;
        if ((channel.recipients?.length ?? 0) >= maxGroupDmRecipients) throw DiscordApiErrors.MAXIMUM_NUMBER_OF_RECIPIENTS_REACHED.withParams(String(maxGroupDmRecipients));
        const recipient = await Recipient.create({ channel_id: channel.id, user_id }).save();
        channel.recipients = [...(channel.recipients ?? []), recipient];
        new_member = true;
        found.uses++;
        await found.save();

        await emitEvent({
            event: "CHANNEL_CREATE",
            data: await DmChannelDTO.from(channel, [user_id]),
            user_id,
        });
        await emitEvent({
            event: "CHANNEL_RECIPIENT_ADD",
            data: { channel_id: channel.id, user: await User.getPublicUser(user_id) },
            channel_id: channel.id,
        } satisfies ChannelRecipientAddEvent);
        await Channel.sendSystemMessage(channel, found.inviter_id ?? user_id, MessageType.RECIPIENT_ADD, { mention_ids: [user_id] });
    } else if (existing.closed) {
        existing.closed = false;
        await existing.save();
        await emitEvent({
            event: "CHANNEL_CREATE",
            data: await DmChannelDTO.from(channel, [user_id]),
            user_id,
        });
    }

    const invite = await Invite.findOneOrFail({
        where: { code: found.code },
        relations: { inviter: true, channel: true },
    });
    await invite.loadGroupRecipients();
    return { ...invite.toPublicJSON(), new_member };
}

router.get(
    "/:invite_code",
    route({
        responses: {
            "200": {
                body: "Invite",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const invite_code = await Invite.resolveCode((req.params as { [key: string]: string }).invite_code);

        const invite = await Invite.findOne({
            where: { code: invite_code },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])), //TODO: clean up
        });
        if (invite?.isFriendInvite()) {
            if (invite.isExpired()) {
                await Invite.delete({ code: invite_code });
                throw DiscordApiErrors.UNKNOWN_INVITE;
            }
            return res.json(invite.toPublicJSON());
        }
        if (!invite?.channel || (!invite.guild && invite.channel.type !== ChannelType.GROUP_DM)) throw DiscordApiErrors.UNKNOWN_INVITE;
        if (invite.isExpired()) {
            await Invite.delete({ code: invite_code });
            throw DiscordApiErrors.UNKNOWN_INVITE;
        }
        await invite.loadGroupRecipients();

        await invite.guild?.withPresenceCount();
        const eventId = req.query.guild_scheduled_event_id ?? req.query.event;
        const guild_id = invite.guild?.id;
        const event =
            guild_id && typeof eventId === "string" && /^\d+$/.test(eventId)
                ? await GuildScheduledEvent.findOne({
                      where: { id: eventId, guild_id },
                      relations: { creator: true },
                  })
                : null;
        const visible =
            !!event &&
            (!event.channel_id ||
                (req.isAuthenticated && (await Member.exists({ where: { id: req.user_id, guild_id } }))
                    ? (await getPermission(req.user_id, guild_id, event.channel_id)).has("VIEW_CHANNEL")
                    : await (async () => {
                          const [channel, everyoneRole] = await Promise.all([
                              Channel.findOne({ where: { id: event.channel_id!, guild_id }, select: { id: true, permission_overwrites: true } }),
                              Role.findOne({ where: { id: guild_id }, select: { id: true, permissions: true } }),
                          ]);
                          if (!channel || !everyoneRole) return false;
                          const overwrite = channel.permission_overwrites?.find((x) => x.type === ChannelPermissionOverwriteType.role && x.id === guild_id);
                          return new Permissions(Permissions.channelPermission(overwrite ? [overwrite] : [], BigInt(everyoneRole.permissions ?? "0"), guild_id)).has(
                              "VIEW_CHANNEL",
                          );
                      })()));
        res.status(200).send({
            ...invite.toPublicJSON(),
            ...(event && visible ? { guild_scheduled_event: await ScheduledEvents.serialize(event) } : {}),
        });
    },
);

router.post(
    "/:invite_code",
    route({
        right: "USE_MASS_INVITES",
        responses: {
            "200": {
                body: "Invite",
            },
            401: {
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
        if (req.user_bot && !Config.get().user.botsCanUseInvites) throw DiscordApiErrors.BOT_PROHIBITED_ENDPOINT;

        const invite_code = await Invite.resolveCode((req.params as { [key: string]: string }).invite_code);
        const { public_flags } = req.user;
        const found = await Invite.findOne({
            where: { code: invite_code },
        });
        if (!found) throw DiscordApiErrors.UNKNOWN_INVITE;
        if (found.isFriendInvite()) {
            if (req.user_bot) throw DiscordApiErrors.BOT_PROHIBITED_ENDPOINT;
            const { new_friend } = await acceptFriendInvite(found, req.user_id);
            found.inviter = await User.findOneOrFail({ where: { id: found.inviter_id } });
            return res.json({ ...found.toPublicJSON(), new_member: new_friend });
        }
        if (!found.guild_id) return res.json(await joinGroupDm(found, req.user_id));
        const { guild_id } = found;
        const { features, incidents_data } = await Guild.findOneOrFail({
            where: { id: guild_id },
        });
        const ban = await Ban.findOne({
            where: [
                { guild_id: guild_id, user_id: req.user_id },
                { guild_id: guild_id, ip: req.ip },
            ],
        });

        if (ban) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but is banned by ${ban.user_id === req.user_id ? "User ID" : "IP address"}.`);
            throw DiscordApiErrors.USER_BANNED;
        }

        if ((BigInt(public_flags) & UserFlags.FLAGS.QUARANTINED) === UserFlags.FLAGS.QUARANTINED) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but is quarantined.`);
            throw DiscordApiErrors.UNKNOWN_INVITE;
        }

        if (features.includes("INTERNAL_EMPLOYEE_ONLY") && (public_flags & 1) !== 1) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but is not staff.`);
            throw new HTTPError("Only intended for the staff of this instance.", 401);
        }

        if (features.includes("INVITES_DISABLED")) {
            console.log(`[Invite] User ${req.user_id} tried to join guild ${guild_id} but joins are closed.`);
            throw new HTTPError("Sorry, this guild has joins closed.", 403);
        }

        const invitesPaused = incidents_data?.invites_disabled_until && new Date(incidents_data.invites_disabled_until).getTime() > Date.now();
        if (invitesPaused && !(await Member.findOne({ where: { id: req.user_id, guild_id }, select: { index: true } }))) {
            throw new HTTPError("Invites to this server are paused.", 403);
        }

        if (isApplyGuild(features) && !(found.flags & APPLICATION_BYPASS_INVITE_FLAG) && !(await Member.exists({ where: { id: req.user_id, guild_id } }))) {
            if (found.isExpired()) throw DiscordApiErrors.UNKNOWN_INVITE;
            const join_request = await startJoinRequest(guild_id, req.user_id);
            const invite = await Invite.findOneOrFail({
                where: { code: invite_code },
                relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])),
            });
            await invite.guild?.withPresenceCount();
            return res.json({
                ...invite.toPublicJSON(),
                new_member: true,
                show_verification_form: true,
                join_request: join_request.toJSON("self"),
            });
        }

        const { new_member } = await Invite.joinGuild(req.user_id, invite_code);
        if (new_member) await onGuildMemberJoin(guild_id, req.user_id, invite_code);
        const invite = await Invite.findOneOrFail({
            where: { code: invite_code },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])),
        }).catch(() => null);
        if (!invite) return res.json({ code: invite_code, guild_id, new_member });

        await invite.guild?.withPresenceCount();
        res.json({ ...invite.toPublicJSON(), new_member });
    },
);

// * cant use permission of route() function because path doesn't have guild_id/channel_id
router.delete(
    "/:invite_code",
    route({
        responses: {
            "200": {
                body: "Invite",
            },
            401: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const invite_code = await Invite.resolveCode((req.params as { [key: string]: string }).invite_code);
        const invite = await Invite.findOne({
            where: { code: invite_code },
            relations: Object.fromEntries(PublicInviteRelation.map((i) => [i, true])),
        });
        if (!invite) throw DiscordApiErrors.UNKNOWN_INVITE;
        const { guild_id, channel_id } = invite;

        if (invite.isFriendInvite()) {
            if (invite.inviter_id !== req.user_id) throw DiscordApiErrors.UNKNOWN_INVITE;
            await Invite.delete({ code: invite_code });
            return res.json(invite.toMetadataJSON());
        }
        if (!guild_id) {
            if (!(await Recipient.exists({ where: { channel_id, user_id: req.user_id } }))) throw DiscordApiErrors.UNKNOWN_INVITE;
            await Invite.delete({ code: invite_code });
            await invite.loadGroupRecipients();
            return res.json(invite.toMetadataJSON());
        }

        const permission = await getPermission(req.user_id, guild_id, channel_id);

        if (!permission.has("MANAGE_GUILD") && !permission.has("MANAGE_CHANNELS")) throw new HTTPError("You missing the MANAGE_GUILD or MANAGE_CHANNELS permission", 401);
        permission.assertMfa("MANAGE_GUILD");

        await Promise.all([
            Invite.delete({ code: invite_code }),
            AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.INVITE_DELETE,
                changes: AuditLog.diff({ ...invite, inviter_id: invite.inviter_id }, {}, ["code", "channel_id", "inviter_id", "uses", "max_uses", "max_age", "temporary", "flags"]),
                reason: req.headers["x-audit-log-reason"],
            }),
            emitEvent({
                event: "INVITE_DELETE",
                guild_id: guild_id,
                data: {
                    channel_id: channel_id,
                    guild_id: guild_id,
                    code: invite_code,
                },
            } satisfies InviteDeleteEvent),
        ]);

        res.json(invite.toMetadataJSON());
    },
);

export default router;
