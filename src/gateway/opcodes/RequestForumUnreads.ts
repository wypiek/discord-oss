import { Channel, Message } from "@spacebar/database";
import { In, MoreThan } from "typeorm";
import { WebSocket, Payload, OPCODES, Send } from "@spacebar/gateway";
import { getPermission } from "@spacebar/util";

export const MAX_FORUM_UNREAD_THREADS = 180;
const COUNT_BATCH = 10;
const SNOWFLAKE = /^\d{1,20}$/;

type RequestedThread = { thread_id: string; ack_message_id: string | null };
type ForumUnread = { thread_id: string; missing?: boolean; count?: number };

const isSnowflake = (value: unknown): value is string => typeof value === "string" && SNOWFLAKE.test(value);

export async function onRequestForumUnreads(this: WebSocket, { d }: Payload) {
    const guild_id = d?.guild_id;
    const channel_id = d?.channel_id;
    if (!isSnowflake(guild_id) || !isSnowflake(channel_id) || !Array.isArray(d.threads)) return;

    const requested = new Map<string, RequestedThread>();
    for (const entry of d.threads as { thread_id?: unknown; ack_message_id?: unknown }[]) {
        if (requested.size >= MAX_FORUM_UNREAD_THREADS) break;
        if (!isSnowflake(entry?.thread_id)) continue;
        requested.set(entry.thread_id, { thread_id: entry.thread_id, ack_message_id: isSnowflake(entry.ack_message_id) ? entry.ack_message_id : null });
    }

    const reply = (data: { threads: ForumUnread[]; permission_denied?: boolean }) =>
        Send(this, {
            op: OPCODES.Dispatch,
            t: "FORUM_UNREADS",
            s: this.sequence++,
            d: { guild_id, channel_id, ...data },
        });

    const forum = await Channel.findOne({ where: { id: channel_id, guild_id }, select: { id: true, type: true } });
    const permission = forum?.isForum() ? await getPermission(this.user_id, guild_id, channel_id).catch(() => null) : null;
    if (!permission?.has("VIEW_CHANNEL") || !permission.has("READ_MESSAGE_HISTORY")) return reply({ threads: [], permission_denied: true });

    const threads = requested.size
        ? await Channel.find({ where: { id: In([...requested.keys()]), parent_id: channel_id }, select: { id: true, type: true, last_message_id: true } })
        : [];
    const found = new Map(threads.filter((thread) => thread.isThread() && !thread.isPrivateThread()).map((thread) => [thread.id, thread]));

    const unreads: ForumUnread[] = [];
    const pending = [...requested.values()];
    for (let i = 0; i < pending.length; i += COUNT_BATCH)
        unreads.push(
            ...(await Promise.all(
                pending.slice(i, i + COUNT_BATCH).map(async ({ thread_id, ack_message_id }) => {
                    const thread = found.get(thread_id);
                    if (!thread) return { thread_id, missing: true };
                    const after = ack_message_id ?? thread_id;
                    if (!thread.last_message_id || BigInt(thread.last_message_id) <= BigInt(after)) return { thread_id, count: 0 };
                    return { thread_id, count: await Message.count({ where: { channel_id: thread_id, id: MoreThan(after) } }) };
                }),
            )),
        );

    return reply({ threads: unreads });
}
