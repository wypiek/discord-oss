import { Channel, Recipient } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { In } from "typeorm";

export async function assertChannelOverridesInScope(user_id: string, guild_id: string | null, channel_overrides: Record<string, unknown> | null | undefined) {
    const channel_ids = Object.keys(channel_overrides ?? {});
    if (!channel_ids.length) return;
    const found = guild_id ? await Channel.count({ where: { id: In(channel_ids), guild_id } }) : await Recipient.count({ where: { user_id, channel_id: In(channel_ids) } });
    if (found !== channel_ids.length) throw DiscordApiErrors.UNKNOWN_CHANNEL;
}
