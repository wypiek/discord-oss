import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Emoji, VoiceState } from "@spacebar/database";
import { emitEvent } from "@spacebar/util";
import { HTTPError } from "lambert-server";
import { fieldCaps } from "@spacebar/api/util/utility/fieldCaps";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {}, 400: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as { [key: string]: string };
    const voiceState = await VoiceState.findOne({ where: { user_id: req.user_id, channel_id } });
    if (!voiceState) throw new HTTPError("You must be connected to this voice channel", 400);
    const { emoji_id, emoji_name, animation_type, animation_id } = req.body ?? {};
    if (!emoji_id && !emoji_name) throw new HTTPError("emoji_id or emoji_name is required", 400);
    const caps = fieldCaps();
    caps.text("emoji_id", emoji_id, 20);
    caps.text("emoji_name", emoji_name, 32);
    for (const [key, value] of Object.entries({ animation_type, animation_id }))
        if (value != null && !Number.isInteger(value)) caps.fail(key, "NUMBER_TYPE_COERCE", "Must be an integer.");
    caps.check();
    const emoji = emoji_id
        ? await Emoji.findOne({
              where: { id: String(emoji_id) },
              select: { id: true, name: true, animated: true },
          })
        : null;

    await emitEvent({
        event: "VOICE_CHANNEL_EFFECT_SEND",
        guild_id: voiceState.guild_id ?? undefined,
        channel_id: voiceState.guild_id ? undefined : channel_id,
        data: {
            channel_id,
            guild_id: voiceState.guild_id ?? undefined,
            user_id: req.user_id,
            emoji: {
                id: emoji_id ?? null,
                name: emoji_name ?? emoji?.name ?? null,
                animated: emoji?.animated ?? false,
            },
            animation_type: animation_type ?? 0,
            animation_id: animation_id ?? Math.floor(Math.random() * 20),
        },
    });
    res.sendStatus(204);
});

export default router;
