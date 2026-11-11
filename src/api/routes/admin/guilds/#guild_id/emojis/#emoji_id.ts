import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { AuditLog, Emoji, Guild } from "@spacebar/database";
import { AdminGuildEmojiUpdateSchema, AuditLogEvents } from "@spacebar/schemas";
import { deleteFile, emitEvent, GuildEmojisUpdateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const loadEmoji = async (req: Request) => {
    const guild_id = req.params.guild_id as string;
    assertMirrorGuildEditable(await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, federated_instance: true } }));
    const emoji = await Emoji.findOne({ where: { id: req.params.emoji_id as string, guild_id } });
    if (!emoji) throw new HTTPError("This server has no emoji with that ID", 404);
    if (emoji.managed) throw new HTTPError("This emoji belongs to an integration, so change it there", 400);
    return { guild_id, emoji };
};

const emitEmojis = async (guild_id: string) =>
    emitEvent({ event: "GUILD_EMOJIS_UPDATE", guild_id, data: { guild_id, emojis: await Emoji.find({ where: { guild_id } }) } } satisfies GuildEmojisUpdateEvent);

router.patch(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "AdminGuildEmojiUpdateSchema",
        description: "Rename a custom emoji in any server",
    }),
    async (req: Request, res: Response) => {
        const { guild_id, emoji } = await loadEmoji(req);
        const body = req.body as AdminGuildEmojiUpdateSchema;
        const before = { name: emoji.name };
        emoji.name = body.name;
        await emoji.save();
        const changes = AuditLog.diff(before, emoji, ["name"]);
        if (changes.length)
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.EMOJI_UPDATE,
                target_id: emoji.id,
                changes,
                reason: auditLogReason(req.headers["x-audit-log-reason"]),
            });
        await emitEmojis(guild_id);
        res.json({ id: emoji.id, name: emoji.name });
    },
);

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Delete a custom emoji from any server and its image",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, emoji } = await loadEmoji(req);
        await Emoji.delete({ id: emoji.id, guild_id });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.EMOJI_DELETE,
            target_id: emoji.id,
            changes: AuditLog.diff(emoji, {}, ["name"]),
            reason: auditLogReason(req.headers["x-audit-log-reason"]),
        });
        await deleteFile(`/emojis/${emoji.id}`).catch(() => undefined);
        await emitEmojis(guild_id);
        res.sendStatus(204);
    },
);

export default router;
