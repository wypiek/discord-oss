import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { assertMirrorGuildEditable } from "@spacebar/api/util/utility/federatedAdmin";
import { auditLogReason } from "@spacebar/api/util/utility/fieldCaps";
import { AuditLog, Guild, SoundboardSound } from "@spacebar/database";
import { AuditLogEvents, SoundboardSoundModifySchema } from "@spacebar/schemas";
import { deleteFile, emitEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });
const AUDIT_KEYS = ["name", "volume", "emoji_id", "emoji_name"];

const loadSound = async (req: Request) => {
    const guild_id = req.params.guild_id as string;
    assertMirrorGuildEditable(await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, federated_instance: true } }));
    const sound = await SoundboardSound.findOne({ where: { id: req.params.sound_id as string, guild_id } });
    if (!sound) throw new HTTPError("This server has no sound with that ID", 404);
    return { guild_id, sound };
};

router.patch(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        requestBody: "SoundboardSoundModifySchema",
        description: "Rename a soundboard sound in any server or change its volume and emoji",
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sound } = await loadSound(req);
        const body = req.body as SoundboardSoundModifySchema;
        if (body.name !== undefined && body.name.trim().length < 2) throw new HTTPError("Sound names need at least two characters", 400);
        const before = { name: sound.name, volume: sound.volume, emoji_id: sound.emoji_id, emoji_name: sound.emoji_name };
        if (body.name !== undefined) sound.name = body.name.trim();
        if (body.volume !== undefined) sound.volume = body.volume ?? 1;
        if (body.emoji_id !== undefined || body.emoji_name !== undefined) {
            sound.emoji_id = body.emoji_id || null;
            sound.emoji_name = sound.emoji_id ? null : body.emoji_name?.trim() || null;
        }
        await sound.save();
        const changes = AuditLog.diff(before, sound, AUDIT_KEYS);
        if (changes.length)
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.SOUNDBOARD_SOUND_UPDATE,
                target_id: sound.id,
                changes,
                reason: auditLogReason(req.headers["x-audit-log-reason"]),
            });
        await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_UPDATE", guild_id, data: sound.toJSON() });
        res.json({ id: sound.id, name: sound.name, volume: sound.volume, emoji_id: sound.emoji_id, emoji_name: sound.emoji_name });
    },
);

router.delete(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "Delete a soundboard sound from any server and its audio",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const { guild_id, sound } = await loadSound(req);
        await SoundboardSound.delete({ id: sound.id, guild_id });
        await AuditLog.log({
            guild_id,
            user_id: req.user_id,
            action_type: AuditLogEvents.SOUNDBOARD_SOUND_DELETE,
            target_id: sound.id,
            changes: AuditLog.diff(sound, {}, AUDIT_KEYS),
            reason: auditLogReason(req.headers["x-audit-log-reason"]),
        });
        await deleteFile(`/soundboard-sounds/${sound.id}`).catch(() => undefined);
        await emitEvent({ event: "GUILD_SOUNDBOARD_SOUND_DELETE", guild_id, data: { guild_id, sound_id: sound.id } });
        res.sendStatus(204);
    },
);

export default router;
