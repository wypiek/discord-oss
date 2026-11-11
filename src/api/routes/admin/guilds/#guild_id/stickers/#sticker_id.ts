import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { AuditLog, Guild, Sticker } from "@spacebar/database";
import { AdminGuildStickerUpdateSchema, AuditLogEvents } from "@spacebar/schemas";
import { deleteFile, emitEvent, GuildStickersUpdateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });
const AUDIT_KEYS = ["name", "description", "tags"];

const loadSticker = async (req: Request) => {
    const guild_id = req.params.guild_id as string;
    assertMirrorGuildEditable(await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, federated_instance: true } }));
    const sticker = await Sticker.findOne({ where: { id: req.params.sticker_id as string, guild_id } });
    if (!sticker) throw new HTTPError("This server has no sticker with that ID", 404);
    return { guild_id, sticker };
};

const emitStickers = async (guild_id: string) =>
    emitEvent({ event: "GUILD_STICKERS_UPDATE", guild_id, data: { guild_id, stickers: await Sticker.find({ where: { guild_id } }) } } satisfies GuildStickersUpdateEvent);

router.patch(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "AdminGuildStickerUpdateSchema",
        description: "Rename a sticker in any server or change its description and tags",
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sticker } = await loadSticker(req);
        const body = req.body as AdminGuildStickerUpdateSchema;
        if (body.name !== undefined && body.name.trim().length < 2) throw new HTTPError("Sticker names need at least two characters", 400);
        if (body.tags !== undefined && !body.tags.trim()) throw new HTTPError("Give the sticker at least one tag", 400);
        const before = { name: sticker.name, description: sticker.description, tags: sticker.tags };
        if (body.name !== undefined) sticker.name = body.name.trim();
        if (body.description !== undefined) sticker.description = body.description?.trim() || undefined;
        if (body.tags !== undefined) sticker.tags = body.tags.trim();
        await sticker.save();
        const changes = AuditLog.diff(before, sticker, AUDIT_KEYS);
        if (changes.length)
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.STICKER_UPDATE,
                target_id: sticker.id,
                changes,
                reason: auditLogReason(req.headers["x-audit-log-reason"]),
            });
        await emitStickers(guild_id);
        res.json({ id: sticker.id, name: sticker.name, description: sticker.description ?? null, tags: sticker.tags ?? "" });
    },
);

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Delete a sticker from any server and its image",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sticker } = await loadSticker(req);
        await Sticker.delete({ id: sticker.id, guild_id });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.STICKER_DELETE,
            target_id: sticker.id,
            changes: AuditLog.diff(sticker, {}, AUDIT_KEYS),
            reason: auditLogReason(req.headers["x-audit-log-reason"]),
        });
        await deleteFile(`/stickers/${sticker.id}`).catch(() => undefined);
        await emitStickers(guild_id);
        res.sendStatus(204);
    },
);

export default router;
