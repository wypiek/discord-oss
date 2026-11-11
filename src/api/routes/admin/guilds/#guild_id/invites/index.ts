import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { cursorLimit, cursorPage } from "@spacebar/api/util";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { Random } from "@spacebar/extensions";
import { AuditLog, Channel, Guild, Invite, PublicInviteRelation, User } from "@spacebar/database";
import { AdminGuildInviteCreateSchema, AuditLogEvents, ChannelType } from "@spacebar/schemas";
import { emitEvent, InviteCreateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });
const INVITE_CURSOR = /^(\d{1,15})\.([A-Za-z0-9-]{1,64})$/;
const INVITE_CHANNEL_TYPES = [ChannelType.GUILD_TEXT, ChannelType.GUILD_VOICE, ChannelType.GUILD_NEWS, ChannelType.GUILD_STAGE_VOICE, ChannelType.GUILD_FORUM];

const describe = (invite: Invite, inviters: Map<string, User>) => {
    const inviter = invite.inviter_id ? inviters.get(invite.inviter_id) : undefined;
    return {
        code: invite.code,
        channel: invite.channel ? { id: invite.channel.id, name: invite.channel.name ?? null, type: invite.channel.type } : null,
        inviter: invite.inviter_id
            ? {
                  id: invite.inviter_id,
                  username: inviter?.username ?? null,
                  global_name: inviter?.global_name ?? null,
                  avatar: inviter?.avatar ?? null,
                  discriminator: inviter?.discriminator ?? null,
              }
            : null,
        uses: invite.uses,
        max_uses: invite.max_uses,
        max_age: invite.max_age,
        temporary: invite.temporary,
        vanity: Boolean(invite.vanity_url),
        created_at: invite.created_at,
        expires_at: invite.expires_at ?? null,
        expired: invite.isExpired(),
    };
};

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "List a server's invites newest first, expired ones included. Pass `next` from a page as `after` to read the next one",
        query: {
            after: { type: "string", required: false, description: "The `next` value of the previous page" },
            limit: { type: "number", required: false, description: "1 to 100, 50 by default" },
        },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        const limit = cursorLimit(req.query.limit, 50, 100);
        const after = req.query.after;
        if (after !== undefined && (typeof after !== "string" || !INVITE_CURSOR.test(after))) throw new HTTPError("after must be the next value of a previous page", 400);
        await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true } });

        const query = Invite.createQueryBuilder("invite")
            .leftJoinAndSelect("invite.channel", "channel")
            .where("invite.guild_id = :guild_id", { guild_id })
            .orderBy("invite.created_at", "DESC")
            .addOrderBy("invite.code", "DESC")
            .take(limit + 1);
        if (typeof after === "string") {
            const [, ms, code] = after.match(INVITE_CURSOR)!;
            query.andWhere("(invite.created_at < :at OR (invite.created_at = :at AND invite.code < :code))", { at: new Date(Number(ms)), code });
        }
        const [rows, total] = await Promise.all([query.getMany(), Invite.count({ where: { guild_id } })]);
        const { page, next } = cursorPage(rows, limit, (invite) => `${new Date(invite.created_at).getTime()}.${invite.code}`);
        const inviterIds = [...new Set(page.map((invite) => invite.inviter_id).filter((id): id is string => !!id))];
        const inviters = new Map(
            (inviterIds.length
                ? await User.find({ where: { id: In(inviterIds) }, select: { id: true, username: true, global_name: true, avatar: true, discriminator: true } })
                : []
            ).map((user) => [user.id, user]),
        );
        res.json({ total, next, invites: page.map((invite) => describe(invite, inviters)) });
    },
);

router.post(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "AdminGuildInviteCreateSchema",
        description: "Create an invite to a channel of any server, with you as the inviter",
        responses: { 201: {} },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        const body = req.body as AdminGuildInviteCreateSchema;
        assertMirrorGuildEditable(await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, federated_instance: true } }));
        const channel = await Channel.findOne({ where: { id: body.channel_id, guild_id }, select: { id: true, type: true, name: true } });
        if (!channel) throw new HTTPError("That channel isn't in this server", 400);
        if (!INVITE_CHANNEL_TYPES.includes(channel.type)) throw new HTTPError("Invites can only point at text, voice, announcement, stage or forum channels", 400);
        const max_age = body.max_age ?? 604800;
        const invite = await Invite.create({
            code: Random.getString("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 8),
            temporary: body.temporary ?? false,
            uses: 0,
            max_uses: body.max_uses ?? 0,
            max_age,
            expires_at: max_age ? new Date(Date.now() + max_age * 1000) : undefined,
            created_at: new Date(),
            guild_id,
            channel_id: channel.id,
            inviter_id: req.user_id,
            flags: 0,
        }).save();
        const created = await Invite.findOneOrFail({ where: { code: invite.code }, relations: Object.fromEntries(PublicInviteRelation.map((name) => [name, true])) });
        const data = created.toMetadataJSON();
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.INVITE_CREATE,
            target_id: null,
            changes: AuditLog.diff({}, { ...data, inviter_id: req.user_id, channel_id: channel.id }, [
                "code",
                "channel_id",
                "inviter_id",
                "uses",
                "max_uses",
                "max_age",
                "temporary",
                "flags",
            ]),
            reason: auditLogReason(req.headers["x-audit-log-reason"]),
        });
        await emitEvent({ event: "INVITE_CREATE", data: { ...data, channel_id: channel.id } as unknown as InviteCreateEvent["data"], guild_id } satisfies InviteCreateEvent);
        res.status(201).json(describe(created, new Map((await User.find({ where: { id: req.user_id } })).map((user) => [user.id, user]))));
    },
);

export default router;
