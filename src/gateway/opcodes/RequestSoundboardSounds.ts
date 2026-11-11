import { In } from "typeorm";
import { WebSocket, Payload, OPCODES, Send } from "@spacebar/gateway";
import { Member, SoundboardSound } from "@spacebar/database";

export async function onRequestSoundboardSounds(this: WebSocket, { d }: Payload) {
    const requested = Array.isArray(d?.guild_ids) ? (d.guild_ids as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 200) : [];
    if (!requested.length) return;

    const members = await Member.find({
        where: { id: this.user_id, guild_id: In(requested) },
        select: { guild_id: true },
    });
    const guild_ids = members.map((m) => m.guild_id);
    const sounds = guild_ids.length
        ? await SoundboardSound.find({
              where: { guild_id: In(guild_ids) },
              relations: { user: true },
              order: { id: "ASC" },
          })
        : [];

    for (const guild_id of guild_ids) {
        await Send(this, {
            op: OPCODES.Dispatch,
            t: "SOUNDBOARD_SOUNDS",
            s: this.sequence++,
            d: {
                guild_id,
                soundboard_sounds: sounds.filter((sound) => sound.guild_id === guild_id).map((sound) => sound.toJSON()),
            },
        });
    }
}
