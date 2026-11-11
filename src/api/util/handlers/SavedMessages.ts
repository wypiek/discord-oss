import { Channel, Message, SavedMessage } from "@spacebar/database";
import { In } from "typeorm";
import { getPermission } from "@spacebar/util";

export const savedMessageRelations = {
    author: true,
    webhook: true,
    application: true,
    mentions: true,
    mention_roles: true,
    mention_channels: true,
    sticker_items: true,
    attachments: true,
    channel: { recipients: { user: true } },
} as const;

export async function canReadMessage(userId: string, message: Message) {
    try {
        const permissions = await getPermission(userId, message.guild_id ?? undefined, message.channel_id);
        return permissions.has("VIEW_CHANNEL") && (message.author_id === userId || permissions.has("READ_MESSAGE_HISTORY"));
    } catch {
        return false;
    }
}

function channelSummary(channel: Channel | undefined, userId: string) {
    if (!channel) return "";
    if (channel.name) return channel.name;
    return (channel.recipients ?? [])
        .filter((recipient) => recipient.user_id !== userId)
        .map((recipient) => recipient.user?.global_name ?? recipient.user?.username)
        .filter(Boolean)
        .join(", ");
}

export function savedMessageResult(saved: SavedMessage, message: Message | null, userId: string) {
    const author = message?.author;
    return {
        message: message ? message.toPublicJSON(userId) : null,
        save_data: {
            channel_id: saved.channel_id,
            message_id: saved.message_id,
            saved_at: saved.saved_at.toISOString(),
            due_at: saved.due_at?.toISOString() ?? null,
            notes: saved.notes ?? "",
            guild_id: message?.guild_id ?? 0,
            author_id: message?.author_id ?? 0,
            author_summary: author?.global_name ?? author?.username ?? message?.webhook?.name ?? "",
            channel_summary: channelSummary(message?.channel, userId),
            message_summary: (message?.content || message?.attachments?.[0]?.filename || "").slice(0, 200),
        },
    };
}

export async function savedMessageResults(saved: SavedMessage[], userId: string) {
    const messages = saved.length
        ? await Message.find({
              where: { id: In(saved.map((entry) => entry.message_id)) },
              relations: savedMessageRelations,
          })
        : [];
    const byId = new Map(messages.map((message) => [message.id, message]));
    const results = [];
    for (const entry of saved) {
        const message = byId.get(entry.message_id) ?? null;
        results.push(savedMessageResult(entry, message && (await canReadMessage(userId, message)) ? message : null, userId));
    }
    return results;
}
