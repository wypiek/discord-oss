import { Intents } from "@spacebar/util";
import type { Payload } from "./Constants";
import type { WebSocket } from "./WebSocket";

const sharedEvents = new Set(Object.values(Intents.DM_INTENT_TO_EVENTS_MAP).flat());
const intentByEvent = new Map<string, bigint>();
const guildIntentByEvent = new Map<string, bigint>();
const dmIntentByEvent = new Map<string, bigint>();

for (const [bit, events] of Object.entries(Intents.INTENT_TO_EVENTS_MAP)) for (const event of events) intentByEvent.set(event, 1n << BigInt(bit));
for (const [bit, events] of Object.entries(Intents.GUILD_INTENT_TO_EVENTS_MAP)) {
    for (const event of events) (sharedEvents.has(event) ? guildIntentByEvent : intentByEvent).set(event.trim(), 1n << BigInt(bit));
}
for (const [bit, events] of Object.entries(Intents.DM_INTENT_TO_EVENTS_MAP)) for (const event of events) dmIntentByEvent.set(event, 1n << BigInt(bit));
intentByEvent.set("INVITE_CREATE", 1n << 6n);
intentByEvent.set("INVITE_DELETE", 1n << 6n);
intentByEvent.set("VOICE_CHANNEL_STATUS_UPDATE", 1n);
intentByEvent.set("VOICE_CHANNEL_START_TIME_UPDATE", 1n);

export function botIntentsAllowed(intents: Intents, flags: number, guildCount: number) {
    const approvals = [
        [Intents.FLAGS.GUILD_PRESENCES, 1 << 12, 1 << 13],
        [Intents.FLAGS.GUILD_MEMBERS, 1 << 14, 1 << 15],
        [Intents.FLAGS.GUILD_MESSAGES_CONTENT, 1 << 18, 1 << 19],
    ] as const;
    return approvals.every(([intent, approved, limited]) => !intents.has(intent) || !!(flags & approved) || (guildCount < 100 && !!(flags & limited)));
}

function projectMessage(socket: Pick<WebSocket, "intents" | "user_id">, value: Record<string, any>, guildId?: string): Record<string, any> {
    const guild = guildId ?? value.guild_id;
    const allowed =
        !guild ||
        socket.intents?.has(Intents.FLAGS.GUILD_MESSAGES_CONTENT) ||
        value.author?.id === socket.user_id ||
        value.mentions?.some((user: { id?: string }) => user.id === socket.user_id);
    const projected: Record<string, any> = allowed ? { ...value } : { ...value, content: "", embeds: [], attachments: [], components: [], poll: undefined, encrypted: undefined };
    if (value.referenced_message) projected.referenced_message = projectMessage(socket, value.referenced_message, guild);
    if (Array.isArray(value.message_snapshots))
        projected.message_snapshots = value.message_snapshots.map((snapshot: { message?: Record<string, any> }) => ({
            ...snapshot,
            ...(snapshot.message ? { message: projectMessage(socket, snapshot.message, guild) } : {}),
        }));
    return projected;
}

export function filterBotDispatch(socket: Pick<WebSocket, "isBot" | "intents" | "user_id">, payload: Payload, guildId?: string): Payload | undefined {
    if (!socket.isBot || payload.op !== 0 || !payload.t) return payload;
    const event = payload.t;
    if (event === "READY_SUPPLEMENTAL") return undefined;
    const data = payload.d;
    const hasIntent = (bit: bigint) => socket.intents?.has(bit) ?? false;
    if (event === "GUILD_MEMBER_UPDATE" && data?.user?.id === socket.user_id) return payload;
    if (event === "THREAD_MEMBERS_UPDATE") {
        if (hasIntent(1n << 1n)) return payload;
        if (!hasIntent(1n)) return undefined;
        const added = Array.isArray(data?.added_members) ? data.added_members.filter((member: { user_id?: string }) => member.user_id === socket.user_id) : [];
        const removed = Array.isArray(data?.removed_member_ids) ? data.removed_member_ids.filter((id: string) => id === socket.user_id) : [];
        if (!added.length && !removed.length) return undefined;
        return { ...payload, d: { ...data, added_members: added, removed_member_ids: removed } };
    }
    const required = sharedEvents.has(event) ? ((guildId ?? data?.guild_id) ? guildIntentByEvent : dmIntentByEvent).get(event) : intentByEvent.get(event);
    if (required !== undefined && !hasIntent(required)) return undefined;
    if (event === "MESSAGE_CREATE" || event === "MESSAGE_UPDATE") return { ...payload, d: projectMessage(socket, data ?? {}, guildId) };
    if (event === "GUILD_CREATE" || event === "GUILD_UPDATE") {
        return {
            ...payload,
            d: {
                ...data,
                ...(!hasIntent(Intents.FLAGS.GUILD_PRESENCES) && { presences: [] }),
                ...(!hasIntent(Intents.FLAGS.GUILD_VOICE_STATES) && { voice_states: [] }),
                ...(!hasIntent(Intents.FLAGS.GUILD_MEMBERS) &&
                    Array.isArray(data?.members) && { members: data.members.filter((member: { user?: { id?: string } }) => member.user?.id === socket.user_id) }),
            },
        };
    }
    return payload;
}
