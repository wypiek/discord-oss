import { Channel as AMQChannel } from "amqplib";
import { bgRedBright } from "picocolors";
import { Ban, Channel, Member, Message, Recipient, Relationship, ThreadMember, User } from "@spacebar/database";
import { EVENTEnum, EventOpts, getGuildPermissions, getPermission, listenEvent, ListenEventOpts, NewUrlUserSignatureData, Permissions, RabbitMQ } from "@spacebar/util";
import { WebSocket } from "@spacebar/gateway";
import { ChannelType, PublicMember, RelationshipType } from "@spacebar/schemas";
import { In, Not } from "typeorm";
import { CLOSECODES, holdForResume, OPCODES, resolveSocket, Send } from "../util";
import { markMemberListsStale, resyncMemberList } from "../opcodes/LazyRequest";

// TODO: close connection on Invalidated Token
// TODO: check intent
// TODO: Guild Member Update is sent for current-user updates regardless of whether the GUILD_MEMBERS intent is set.

// Sharding: calculate if the current shard id matches the formula: shard_id = (guild_id >> 22) % num_shards
// https://discord.com/developers/docs/topics/gateway#sharding

const guildChannels = new WeakMap<object, Map<string, Set<string>>>();
const guildWork = new WeakMap<object, Map<string, Promise<void>>>();
const channelReads = new Map<string, Promise<ListenedChannel[]>>();
const threadReads = new Map<string, Promise<ListenedChannel[]>>();
const threadTypes = [ChannelType.GUILD_NEWS_THREAD, ChannelType.GUILD_PUBLIC_THREAD, ChannelType.GUILD_PRIVATE_THREAD];
const publicThreadTypes = new Set([ChannelType.GUILD_NEWS_THREAD, ChannelType.GUILD_PUBLIC_THREAD]);

type ListenedChannel = Pick<Channel, "id" | "type" | "parent_id"> & Partial<Pick<Channel, "permission_overwrites" | "guild_id">>;
type ChannelRoute = Pick<Channel, "id" | "type" | "parent_id"> & {
    guild_id: string;
    subscribers: Map<object, WebSocket>;
    cancel?: Promise<(() => Promise<unknown>) | undefined>;
};
type GuildRoute = { members: Set<object>; channels: Set<string>; privateThreads: Set<string> };
const channelRoutes = new Map<string, ChannelRoute>();
const guildRoutes = new Map<string, GuildRoute>();
let routesFollowReconnects = false;

function batchedRead<T>(load: (key: string, users: string[]) => Promise<Map<string, T>>) {
    const pending = new Map<string, { users: Set<string>; read: Promise<Map<string, T>> }>();
    return (key: string, user_id: string) => {
        let batch = pending.get(key);
        if (!batch) {
            const users = new Set<string>();
            const read = new Promise((resolve) => setImmediate(resolve)).then(() => {
                pending.delete(key);
                return load(key, [...users]);
            });
            pending.set(key, (batch = { users, read }));
        }
        batch.users.add(user_id);
        return batch.read.then((result) => result.get(user_id));
    };
}
const readGuildPermission = batchedRead(getGuildPermissions);
const readJoinedThreads = batchedRead(async (guild_id, users) => {
    const joined = new Map(users.map((user) => [user, new Set<string>()]));
    const threads = [...(guildRoutes.get(guild_id)?.privateThreads ?? [])];
    if (threads.length)
        for (const member of await ThreadMember.find({ where: { user_id: In(users), id: In(threads) }, select: { id: true, user_id: true } }))
            joined.get(member.user_id)?.add(member.id);
    return joined;
});
function sharedRead(reads: Map<string, Promise<ListenedChannel[]>>, guild_id: string, load: () => Promise<ListenedChannel[]>) {
    let read = reads.get(guild_id);
    if (read) return read;
    read = load();
    reads.set(guild_id, read);
    void read
        .finally(() => {
            if (reads.get(guild_id) === read) reads.delete(guild_id);
        })
        .catch(() => undefined);
    return read;
}
const readGuildChannels = (guild_id: string) =>
    sharedRead(channelReads, guild_id, () =>
        Channel.find({
            where: { guild_id, type: Not(In(threadTypes)) },
            select: { id: true, type: true, parent_id: true, permission_overwrites: true },
        }),
    );
const loadGuildThreads = (guild_id: string) =>
    sharedRead(threadReads, guild_id, () => Channel.find({ where: { guild_id, type: In(threadTypes) }, select: { id: true, type: true, parent_id: true } }));
const readGuildThreads = (guild_id: string) => (guildRoutes.has(guild_id) ? undefined : loadGuildThreads(guild_id));

function deliverChannelEvent(channel_id: string, opts: EventOpts) {
    opts.acknowledge?.();
    const route = channelRoutes.get(channel_id);
    const audience = route && (publicThreadTypes.has(route.type) && route.parent_id ? channelRoutes.get(route.parent_id)?.subscribers : route.subscribers);
    if (!audience?.size) return;
    const event = { ...opts, acknowledge: undefined };
    return Promise.allSettled([...audience.values()].map((socket) => consume.call(socket, event)));
}
function listenRoute(route: ChannelRoute) {
    route.cancel = listenEvent(route.id, (opts) => deliverChannelEvent(route.id, opts), { acknowledge: true }).catch((error) => {
        console.error(`[Gateway] could not listen for channel ${route.id}`, error);
        return undefined;
    });
}
function registerChannel(guild_id: string, channel: ListenedChannel) {
    const guild = guildRoutes.get(guild_id);
    if (!guild) return;
    const existing = channelRoutes.get(channel.id);
    if (existing) {
        existing.type = channel.type;
        existing.parent_id = channel.parent_id;
        return;
    }
    const route: ChannelRoute = {
        id: channel.id,
        type: channel.type,
        parent_id: channel.parent_id,
        guild_id,
        subscribers: new Map(),
    };
    channelRoutes.set(channel.id, route);
    guild.channels.add(channel.id);
    if (channel.type === ChannelType.GUILD_PRIVATE_THREAD) guild.privateThreads.add(channel.id);
    if (!routesFollowReconnects) {
        routesFollowReconnects = true;
        RabbitMQ.on("reconnected", () => {
            for (const route of channelRoutes.values()) listenRoute(route);
        });
    }
    listenRoute(route);
}
function dropChannel(id: string) {
    const route = channelRoutes.get(id);
    if (!route) return;
    channelRoutes.delete(id);
    const guild = guildRoutes.get(route.guild_id);
    guild?.channels.delete(id);
    guild?.privateThreads.delete(id);
    void route.cancel?.then((cancel) => cancel?.());
}
function joinGuild(socket: WebSocket, guild_id: string, threads?: ListenedChannel[]) {
    let guild = guildRoutes.get(guild_id);
    if (!guild) {
        guildRoutes.set(guild_id, (guild = { members: new Set(), channels: new Set(), privateThreads: new Set() }));
        if (threads) for (const thread of threads) registerChannel(guild_id, thread);
        else
            loadGuildThreads(guild_id)
                .then((rows) => rows.forEach((thread) => registerChannel(guild_id, thread)))
                .catch((error) => console.error(`[Gateway] could not load the threads of guild ${guild_id}`, error));
    }
    guild.members.add(socket.permissions);
    const owned = ownedChannels(socket);
    if (!owned.has(guild_id)) owned.set(guild_id, new Set());
}
function leaveGuild(socket: WebSocket, guild_id: string) {
    setOwned(socket, guild_id, new Set());
    ownedChannels(socket).delete(guild_id);
    const guild = guildRoutes.get(guild_id);
    if (!guild?.members.delete(socket.permissions) || guild.members.size) return;
    guildRoutes.delete(guild_id);
    for (const id of [...guild.channels]) dropChannel(id);
}
function ownedChannels(socket: WebSocket) {
    let owned = guildChannels.get(socket.permissions);
    if (!owned) guildChannels.set(socket.permissions, (owned = new Map()));
    return owned;
}
function setOwned(socket: WebSocket, guild_id: string, visible: Set<string>) {
    const owned = ownedChannels(socket);
    for (const id of owned.get(guild_id) ?? []) if (!visible.has(id)) channelRoutes.get(id)?.subscribers.delete(socket.permissions);
    if (!guildRoutes.get(guild_id)?.members.has(socket.permissions)) return;
    for (const id of visible) channelRoutes.get(id)?.subscribers.set(socket.permissions, socket);
    owned.set(guild_id, visible);
}
function canSee(socket: WebSocket, guild_id: string, channel_id: string, fallback?: Partial<ListenedChannel>) {
    const owned = ownedChannels(socket).get(guild_id);
    if (!owned) return false;
    if (owned.has(channel_id)) return true;
    const route = channelRoutes.get(channel_id) ?? fallback;
    return route?.type !== undefined && publicThreadTypes.has(route.type) && !!route.parent_id && owned.has(route.parent_id);
}
export function subscribedChannels(socket: WebSocket) {
    return new Set([...channelRoutes.values()].filter((route) => canSee(socket, route.guild_id, route.id)).map((route) => route.id));
}
function eventGuild(opts: EventOpts): string | undefined {
    return (
        opts.guild_id ??
        opts.data?.guild_id ??
        (["GUILD_CREATE", "GUILD_DELETE", "GUILD_UPDATE"].includes(opts.event) ? opts.data?.id : undefined) ??
        channelRoutes.get(opts.channel_id ?? opts.data?.channel_id ?? opts.data?.id)?.guild_id
    );
}
async function cancelSubscription(socket: WebSocket, id: string) {
    const cancel = socket.events[id];
    delete socket.events[id];
    await cancel?.();
}
function visibleChannels(permission: Permissions, channels: ListenedChannel[], joinedThreads: Set<string>) {
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const sourcePermissions = new Map<string, Permissions>();
    const visible = new Set<string>();
    for (const channel of channels) {
        if (publicThreadTypes.has(channel.type)) continue;
        const source = channel.type === ChannelType.GUILD_PRIVATE_THREAD ? byId.get(channel.parent_id!) : channel;
        if (!source) continue;
        let perms = sourcePermissions.get(source.id);
        if (!perms) {
            perms = permission.has("ADMINISTRATOR") ? permission : permission.overwriteChannel(source.permission_overwrites ?? []);
            sourcePermissions.set(source.id, perms);
        }
        if (!perms.has("VIEW_CHANNEL")) continue;
        if (channel.type === ChannelType.GUILD_PRIVATE_THREAD && !joinedThreads.has(channel.id) && !perms.has("MANAGE_THREADS")) continue;
        visible.add(channel.id);
    }
    return visible;
}
const privateThreads = (guild_id: string) =>
    [...(guildRoutes.get(guild_id)?.privateThreads ?? [])].map((id) => channelRoutes.get(id)).filter((route): route is ChannelRoute => !!route);
function subscribeCreatedChannel(socket: WebSocket, guild_id: string, channel: ListenedChannel) {
    registerChannel(guild_id, channel);
    const permission = socket.permissions[guild_id];
    if (!permission || (!permission.cache && !permission.has("ADMINISTRATOR"))) return;
    if (!visibleChannels(permission, [channel], new Set()).has(channel.id)) return;
    setOwned(socket, guild_id, new Set([...(ownedChannels(socket).get(guild_id) ?? []), channel.id]));
}
async function reconcileGuild(socket: WebSocket, guild_id: string, refreshPermission: boolean) {
    if (refreshPermission) {
        socket.permissions[guild_id] = new Permissions(0);
        socket.permissions[guild_id] = (await readGuildPermission(guild_id, socket.user_id).catch(() => undefined)) ?? new Permissions(0);
    }
    const permission = socket.permissions[guild_id];
    if (!permission || (!permission.cache && !permission.has("ADMINISTRATOR"))) return setOwned(socket, guild_id, new Set());
    const channels = await readGuildChannels(guild_id);
    for (const channel of channels) registerChannel(guild_id, channel);
    const threads = privateThreads(guild_id);
    const joined = threads.length ? ((await readJoinedThreads(guild_id, socket.user_id)) ?? new Set<string>()) : new Set<string>();
    setOwned(socket, guild_id, visibleChannels(permission, [...channels, ...threads], joined));
}

export function handlePresenceUpdate(this: WebSocket, opts: EventOpts): Promise<unknown> | undefined {
    if (this.resumedBy) return handlePresenceUpdate.call(resolveSocket(this), opts);
    const { event, acknowledge, data, user_id } = opts;
    acknowledge?.();
    if (event === EVENTEnum.PresenceUpdate && data?.user?.id === user_id && user_id !== this.user_id) {
        return Send(this, {
            op: OPCODES.Dispatch,
            t: event,
            d: data,
            s: this.sequence++,
        });
    }
}

export async function setupListener(this: WebSocket) {
    const [members, recipients, relationships, threadMembers, user] = await Promise.all([
        Member.find({
            where: { id: this.user_id },
            relations: { guild: true, roles: true },
            select: {
                index: true,
                id: true,
                guild_id: true,
                communication_disabled_until: true,
                roles: { id: true, permissions: true, position: true },
                guild: { id: true, owner_id: true },
            },
        }),
        Recipient.find({
            where: { user_id: this.user_id, closed: false },
            select: { id: true, channel_id: true },
        }),
        Relationship.find({
            where: { from_id: this.user_id, type: RelationshipType.FRIEND },
            select: { id: true, to_id: true },
        }),
        ThreadMember.find({ where: { user_id: this.user_id }, select: { id: true } }),
        User.findOne({ where: { id: this.user_id }, select: { id: true, flags: true } }),
    ]);
    const joinedThreads = new Set(threadMembers.map((m) => m.id));
    const guildIds = members.map((member) => member.guild_id);
    const [guildChannelRows, guildThreads] = await Promise.all([
        guildIds.length
            ? Channel.find({
                  where: { guild_id: In(guildIds), type: Not(In(threadTypes)) },
                  select: { id: true, type: true, parent_id: true, permission_overwrites: true, guild_id: true },
              })
            : [],
        Promise.all(guildIds.map(readGuildThreads)),
    ]);
    const channelsByGuild = new Map<string, ListenedChannel[]>();
    for (const channel of guildChannelRows) {
        const list = channelsByGuild.get(channel.guild_id!);
        if (list) list.push(channel);
        else channelsByGuild.set(channel.guild_id!, [channel]);
    }
    const dmUsers = recipients.length
        ? await Recipient.find({
              where: { channel_id: In(recipients.map((x) => x.channel_id)), user_id: Not(this.user_id) },
              select: { id: true, user_id: true },
          })
        : [];
    this.affinityUsers = new Set([...relationships.map((x) => x.to_id), ...dmUsers.map((x) => x.user_id)]);

    const friendIds = relationships.map((x) => x.to_id);
    for (const member of members) {
        const guild = member.guild;
        const permission = Permissions.finalPermission({
            user: {
                id: this.user_id,
                roles: member.roles.map((x) => x.id),
                communication_disabled_until: member.communication_disabled_until ?? null,
                flags: user?.flags ?? 0,
            },
            guild: { id: guild.id, owner_id: guild.owner_id!, roles: member.roles },
        });
        permission.cache = { guild_id: guild.id, roles: member.roles, user_id: this.user_id };
        this.permissions[guild.id] = permission;
    }
    members.forEach((member, i) => {
        const channels = channelsByGuild.get(member.guild_id) ?? [];
        joinGuild(this, member.guild_id, guildThreads[i]);
        for (const channel of channels) registerChannel(member.guild_id, channel);
        setOwned(this, member.guild_id, visibleChannels(this.permissions[member.guild_id], [...channels, ...privateThreads(member.guild_id)], joinedThreads));
    });

    const opts: {
        acknowledge: boolean;
        channel?: AMQChannel & { queues?: unknown; ch?: number };
    } = {
        acknowledge: true,
    };
    this.listen_options = opts;
    const consumer = consume.bind(this);
    const presenceConsumer = handlePresenceUpdate.bind(this);

    const handleChannelError = (err: unknown) => {
        console.error(`[RabbitMQ] [user-${this.user_id}] Channel Error (Handled):`, err);
    };

    const setupEventListeners = async () => {
        if (RabbitMQ.connection) {
            console.log(`[RabbitMQ] [user-${this.user_id}] Setting up channel and event listeners`);
            opts.channel = await RabbitMQ.connection.createChannel();

            opts.channel.on("error", handleChannelError);
            opts.channel.queues = {};
            console.log("[RabbitMQ] channel created: ", typeof opts.channel, "with channel id", opts.channel?.ch);
        }

        this.events[this.user_id] = await listenEvent(this.user_id, consumer, opts);
        this.events[this.session_id] = await listenEvent(this.session_id, consumer, opts);
        const authSessionId = this.session?.session_id;
        if (authSessionId && authSessionId !== this.session_id) this.events[authSessionId] = await listenEvent(authSessionId, consumer, opts);

        await Promise.all([
            ...friendIds.map(async (id) => {
                this.events[id] = await listenEvent(id, presenceConsumer, opts);
            }),
            ...[...Object.keys(this.permissions), ...recipients.map((recipient) => recipient.channel_id)].map(async (id) => {
                this.events[id] = await listenEvent(id, consumer, opts);
            }),
        ]);
    };

    try {
        await setupEventListeners();
    } catch (error) {
        for (const guild_id of [...ownedChannels(this).keys()]) leaveGuild(this, guild_id);
        throw error;
    }

    // Handle RabbitMQ reconnection - re-establish all subscriptions
    const handleReconnect = async () => {
        console.log(`[RabbitMQ] [user-${this.user_id}] Connection restored, re-establishing subscriptions`);
        try {
            // Clear old event handlers (they're now invalid)
            this.events = {};
            this.member_events = {};
            opts.channel = undefined;

            // re-establish all subscriptions
            await setupEventListeners();
            console.log(`[RabbitMQ] [user-${this.user_id}] Successfully re-established subscriptions`);
        } catch (e) {
            console.error(`[RabbitMQ] [user-${this.user_id}] Failed to re-establish subscriptions:`, e);
            // close the WebSocket - will force client to reconnect and redo subscription setup
            this.close(4000, "Failed to re-establish event subscriptions");
        }
    };

    const handleDisconnect = () => {
        console.log(`[RabbitMQ] [user-${this.user_id}] Connection lost, waiting for reconnection`);
        // mark channel invalid
        if (opts.channel) {
            opts.channel.off("error", handleChannelError);
        }
        opts.channel = undefined;
    };

    // Subscribe to RabbitMQ connection events
    RabbitMQ.on("reconnected", handleReconnect);
    RabbitMQ.on("disconnected", handleDisconnect);

    this.listenerCleanup = async () => {
        RabbitMQ.off("reconnected", handleReconnect);
        RabbitMQ.off("disconnected", handleDisconnect);
        for (const guild_id of [...ownedChannels(this).keys()]) leaveGuild(this, guild_id);

        // wait for event consumer cancellation
        await Promise.all(
            Object.values(this.events).map((x) => {
                if (x) return x();
                else return Promise.resolve();
            }),
        );
        await Promise.all(Object.values(this.member_events).map((x) => x()));

        if (opts.channel) {
            try {
                await opts.channel.close();
            } catch {
                // Channel might already be closed
            }
            opts.channel.off("error", handleChannelError);
        }
    };
    if (this.readyState === this.CLOSED) await this.listenerCleanup();
    else this.once("close", (code: number) => holdForResume(this, this.listenerCleanup!, code));
}

// TODO: only subscribe for events that are in the connection intents
export async function consume(this: WebSocket, opts: EventOpts): Promise<void> {
    if (this.resumedBy) return consume.call(resolveSocket(this), opts);
    const guild_id = eventGuild(opts);
    if (!guild_id) return consumeEvent.call(this, opts);
    let work = guildWork.get(this.permissions);
    if (!work) guildWork.set(this.permissions, (work = new Map()));
    const pending = (work.get(guild_id) ?? Promise.resolve()).then(() => consumeEvent.call(this, opts));
    work.set(guild_id, pending);
    try {
        await pending;
    } catch (error) {
        delete this.permissions[guild_id];
        setOwned(this, guild_id, new Set());
        console.error("[Gateway] Guild event reconciliation failed", error);
    } finally {
        if (work.get(guild_id) === pending) work.delete(guild_id);
    }
}

async function consumeEvent(this: WebSocket, opts: EventOpts): Promise<void> {
    if (this.resumedBy) return consume.call(resolveSocket(this), opts);
    const { data, event } = opts;
    if (opts.session_user_id && opts.session_user_id !== this.user_id) {
        opts.acknowledge?.();
        return;
    }
    const id = (opts.guild_id || opts.channel_id || opts.user_id || opts.session_id) as string;
    const guild_id = eventGuild(opts);
    let permission = guild_id ? (this.permissions[guild_id] ?? new Permissions(0)) : Permissions.DEFAULT_DM_PERMISSIONS;

    const consumer = consume.bind(this);
    const listenOpts = opts as ListenEventOpts;
    opts.acknowledge?.();
    // console.log("event", event);

    // deduplicate gateway messages
    if (opts.transaction_id) {
        if (this.recentTransactions.includes(opts.transaction_id)) return;
        this.recentTransactions.push(opts.transaction_id);
        if (this.recentTransactions.length > 100) this.recentTransactions = this.recentTransactions.slice(1);
    }

    // special codes
    switch (event) {
        case "SB_SESSION_CLOSE":
            // TODO: what do we even send here?
            await Send(this, {
                op: OPCODES.Reconnect,
                s: this.sequence++,
                d: opts.reconnect_delay ?? opts.data ?? 1000,
            });
            this.close(1000); // not a discord close code, standard WS "Normal Closure"
            return;
        case "SB_SESSION_REMOVE":
            // TODO: what do we even send here?
            await Send(this, {
                op: OPCODES.Invalid_Session,
                s: this.sequence++,
            });
            this.close(CLOSECODES.Invalid_session); // TODO: this is deprecated?
            return;
        default:
            // no special treatment
            break;
    }

    // subscription managment
    switch (event) {
        case "GUILD_MEMBER_REMOVE":
            if (guild_id && data.user.id === this.user_id) {
                delete this.permissions[guild_id];
                delete this.member_lists?.[guild_id];
                delete this.presenceSubscriptions?.[guild_id];
                leaveGuild(this, guild_id);
            }
            this.member_events[data.user.id]?.();
            delete this.member_events[data.user.id];
            break;
        case "GUILD_MEMBER_ADD":
            if (this.member_events[data.user.id]) break; // already subscribed
            this.member_events[data.user.id] = await listenEvent(data.user.id, handlePresenceUpdate.bind(this), this.listen_options);
            break;
        case "GUILD_UPDATE":
        case "GUILD_ROLE_CREATE":
        case "GUILD_ROLE_UPDATE":
        case "GUILD_ROLE_DELETE":
            if (guild_id) await reconcileGuild(this, guild_id, true);
            permission = guild_id ? (this.permissions[guild_id] ?? new Permissions(0)) : permission;
            break;
        case "GUILD_MEMBER_UPDATE":
            if (guild_id && data.user.id === this.user_id) await reconcileGuild(this, guild_id, true);
            break;
        case "RELATIONSHIP_REMOVE":
        case "CHANNEL_DELETE":
        case "GUILD_DELETE": {
            const target = typeof data?.id === "string" ? data.id : id;
            if (event === "CHANNEL_DELETE" && guild_id && !canSee(this, guild_id, target, data)) return;
            if (target !== this.user_id && target !== this.session_id && target !== this.session?.session_id) {
                await cancelSubscription(this, target);
            }
            if (event === "GUILD_DELETE") {
                delete this.permissions[target];
                delete this.member_lists?.[target];
                delete this.presenceSubscriptions?.[target];
                leaveGuild(this, target);
            }
            if (event === "CHANNEL_DELETE" && guild_id) {
                setOwned(this, guild_id, new Set([...(ownedChannels(this).get(guild_id) ?? [])].filter((channel) => channel !== target)));
                dropChannel(target);
            }
            if (event === "GUILD_DELETE" && this.ipAddress) {
                const ban = await Ban.findOne({
                    where: { guild_id: target, user_id: this.user_id },
                });

                if (ban) {
                    ban.ip = this.ipAddress || undefined;
                    await ban.save();
                }
            }
            break;
        }
        case "CHANNEL_CREATE":
            for (const recipient of data.recipients ?? []) if (recipient?.id && recipient.id !== this.user_id) this.affinityUsers?.add(recipient.id);
            if (guild_id) {
                if (typeof data?.id === "string" && !threadTypes.includes(data.type)) subscribeCreatedChannel(this, guild_id, data);
                else {
                    registerChannel(guild_id, data);
                    if (data.type === ChannelType.GUILD_PRIVATE_THREAD) await reconcileGuild(this, guild_id, false);
                }
                if (!canSee(this, guild_id, data.id)) return;
                break;
            }
            if (!permission.has("VIEW_CHANNEL")) return;
            if (!this.events[data.id]) this.events[data.id] = await listenEvent(data.id, consumer, listenOpts);
            break;
        case "THREAD_CREATE":
            if (guild_id) {
                registerChannel(guild_id, data);
                if (data.type === ChannelType.GUILD_PRIVATE_THREAD) await reconcileGuild(this, guild_id, false);
                if (!canSee(this, guild_id, data.id)) return;
                break;
            }
            if (!this.events[data.id]) this.events[data.id] = await listenEvent(data.id, consumer, listenOpts);
            break;
        case "THREAD_MEMBERS_UPDATE":
            if (guild_id) {
                if (channelRoutes.get(data.id)?.type === ChannelType.GUILD_PRIVATE_THREAD) await reconcileGuild(this, guild_id, false);
                if (!canSee(this, guild_id, data.id)) return;
            }
            break;
        case "THREAD_DELETE":
            await cancelSubscription(this, data.id);
            if (guild_id) {
                setOwned(this, guild_id, new Set([...(ownedChannels(this).get(guild_id) ?? [])].filter((channel) => channel !== data.id)));
                dropChannel(data.id);
            }
            break;
        case "RELATIONSHIP_ADD": {
            const target = data.user?.id ?? data.id;
            if (!target) break;
            if (data.type !== RelationshipType.FRIEND) {
                this.affinityUsers?.delete(target);
                await cancelSubscription(this, target);
                break;
            }
            this.affinityUsers?.add(target);
            if (!this.events[target]) this.events[target] = await listenEvent(target, handlePresenceUpdate.bind(this), this.listen_options);
            break;
        }
        case "GUILD_CREATE": {
            const guildPermission = await getPermission(this.user_id, data.id).catch(() => undefined);
            if (!guildPermission) return;
            this.permissions[data.id] = guildPermission;
            if (!this.events[data.id]) this.events[data.id] = await listenEvent(data.id, consumer, this.listen_options);
            joinGuild(this, data.id, await readGuildThreads(data.id));
            await reconcileGuild(this, data.id, false);
            break;
        }
        case "CHANNEL_UPDATE": {
            if (!guild_id) break;
            await reconcileGuild(this, guild_id, false);
            if (!canSee(this, guild_id, data.id, data)) return;
            break;
        }
        default:
            // no special treatment
            break;
    }

    // permission checking
    switch (event) {
        case "INVITE_CREATE":
        case "INVITE_DELETE":
        case "GUILD_INTEGRATIONS_UPDATE":
        case "AUTO_MODERATION_RULE_CREATE":
        case "AUTO_MODERATION_RULE_UPDATE":
        case "AUTO_MODERATION_RULE_DELETE":
        case "AUTO_MODERATION_ACTION_EXECUTION":
        case "AUTO_MODERATION_MENTION_RAID_DETECTION":
            if (!permission.has("MANAGE_GUILD")) return;
            break;
        case "WEBHOOKS_UPDATE":
            if (!permission.has("MANAGE_WEBHOOKS")) return;
            break;
        case "GUILD_MEMBER_ADD":
        case "GUILD_MEMBER_REMOVE":
        case "GUILD_MEMBER_UPDATE": // only send them, if the user subscribed for this part of the member list, or is a bot
            break;
        case "PRESENCE_UPDATE": {
            const presenceUser = data?.user?.id;
            if (presenceUser === this.user_id) {
                if (data?.guild_id && this.member_lists?.[data.guild_id]) markMemberListsStale(data.guild_id, "presence");
                return;
            }
            if (
                data?.guild_id &&
                !this.isBot &&
                !this.affinityUsers?.has(presenceUser) &&
                !this.member_lists?.[data.guild_id] &&
                !this.presenceSubscriptions?.[data.guild_id]?.has(presenceUser)
            )
                return;
            break;
        }
        case "GUILD_BAN_ADD":
        case "GUILD_BAN_REMOVE":
            if (!permission.has("BAN_MEMBERS")) return;
            break;
        case "GUILD_JOIN_REQUEST_CREATE":
        case "GUILD_JOIN_REQUEST_UPDATE":
        case "GUILD_JOIN_REQUEST_DELETE":
            if (opts.guild_id && !permission.has("KICK_MEMBERS")) return;
            break;
        case "VOICE_CHANNEL_STATUS_UPDATE":
        case "VOICE_CHANNEL_START_TIME_UPDATE":
            if (!guild_id || !canSee(this, guild_id, data?.id)) return;
            break;
        case "GUILD_SCHEDULED_EVENT_CREATE":
        case "GUILD_SCHEDULED_EVENT_UPDATE":
        case "GUILD_SCHEDULED_EVENT_DELETE":
        case "STAGE_INSTANCE_CREATE":
        case "STAGE_INSTANCE_UPDATE":
        case "STAGE_INSTANCE_DELETE":
        case "VOICE_STATE_UPDATE":
        case "MESSAGE_CREATE":
        case "MESSAGE_DELETE":
        case "MESSAGE_DELETE_BULK":
        case "MESSAGE_UPDATE":
        case "CHANNEL_PINS_UPDATE":
        case "MESSAGE_REACTION_ADD":
        case "MESSAGE_REACTION_REMOVE":
        case "MESSAGE_REACTION_REMOVE_ALL":
        case "MESSAGE_REACTION_REMOVE_EMOJI":
        case "TYPING_START":
            // only gets send if the user is alowed to view the current channel
            if (guild_id) {
                const channel_id = data?.channel_id ?? opts.channel_id;
                if (channel_id ? !canSee(this, guild_id, channel_id) : !permission.has("VIEW_CHANNEL")) return;
            } else if (!permission.has("VIEW_CHANNEL") || (opts.channel_id && !this.events[opts.channel_id])) return;
            break;
        case "GUILD_CREATE":
        case "GUILD_DELETE":
        case "GUILD_UPDATE":
        case "GUILD_ROLE_CREATE":
        case "GUILD_ROLE_UPDATE":
        case "GUILD_ROLE_DELETE":
        case "CHANNEL_CREATE":
        case "CHANNEL_DELETE":
        case "CHANNEL_UPDATE":
        case "GUILD_EMOJIS_UPDATE":
        case "READY": // will be sent by the gateway
        case "USER_UPDATE":
        case "APPLICATION_COMMAND_CREATE":
        case "APPLICATION_COMMAND_DELETE":
        case "APPLICATION_COMMAND_UPDATE":
        default:
            // always gets sent
            // Any events not defined in an intent are considered "passthrough" and will always be sent
            break;
    }

    let dispatched = data;
    if ((event === "MESSAGE_CREATE" || event === "MESSAGE_UPDATE") && (data?.attachments?.length || data?.components?.length)) {
        const signed = Message.prototype.withSignedAttachments.call(data, new NewUrlUserSignatureData({ ip: this.ipAddress, userAgent: this.userAgent }));
        dispatched = {
            ...data,
            ...(data.attachments && { attachments: signed.attachments }),
            ...(data.components && { components: signed.components }),
        };
    }

    if (event === "GUILD_MEMBER_ADD") {
        if ((data as PublicMember).roles === undefined || (data as PublicMember).roles === null) {
            console.log(
                bgRedBright(`[Gateway/${this.user_id}]`),
                "[GUILD_MEMBER_ADD] roles is undefined, setting to empty array!",
                opts.origin ?? "(Event origin not defined)",
                data,
            );
            (data as PublicMember).roles = [];
        }
    }

    const authSessionId = this.session?.session_id;
    await Send(
        this,
        {
            op: OPCODES.Dispatch,
            t: event,
            d:
                event === "SESSIONS_REPLACE" && Array.isArray(data)
                    ? data.map((x: { session_id?: string }) => (x?.session_id === authSessionId ? { ...x, session_id: this.session_id } : x))
                    : dispatched,
            s: this.sequence++,
        },
        guild_id,
    );

    const listGuildId = opts.guild_id ?? data?.guild_id;
    const subscription = listGuildId && this.member_lists?.[listGuildId];
    if (!subscription || !MemberListEvents.has(event)) return;
    if (event === "CHANNEL_UPDATE") {
        if (subscription.channel_id === data?.id) await resyncMemberList(this, listGuildId);
        return;
    }
    markMemberListsStale(listGuildId, event === "PRESENCE_UPDATE" ? "presence" : "members");
}

const MemberListEvents = new Set([
    "PRESENCE_UPDATE",
    "GUILD_MEMBER_ADD",
    "GUILD_MEMBER_UPDATE",
    "GUILD_MEMBER_REMOVE",
    "GUILD_ROLE_CREATE",
    "GUILD_ROLE_UPDATE",
    "GUILD_ROLE_DELETE",
    "CHANNEL_UPDATE",
]);
