import { In } from "typeorm";
import { Message, User } from "@spacebar/database";
import { emitEvent, MessageDeleteEvent } from "@spacebar/util";

// shared by the admin announcement routes; route files can't import each other, since the openapi generator files
// every route a module registers under whichever route file loaded it first

const CHUNK = 500;

/** Deletes announcement dms for everyone, with their attachment files. */
export async function deleteAnnouncementMessages(messages: Pick<Message, "id" | "channel_id">[]) {
    for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk = messages.slice(i, i + CHUNK);
        await Message.delete({ id: In(chunk.map((m) => m.id)) });
        for (const message of chunk)
            await emitEvent({
                event: "MESSAGE_DELETE",
                channel_id: message.channel_id!,
                data: { id: message.id, channel_id: message.channel_id! },
            } satisfies MessageDeleteEvent);
    }
}

export const serializeOfficial = (official: User) => ({
    id: official.id,
    username: official.username,
    discriminator: official.discriminator,
    global_name: official.global_name,
    avatar: official.avatar ?? null,
});
