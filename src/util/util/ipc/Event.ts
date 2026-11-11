import EventEmitter from "node:events";
import path from "node:path";
import { Channel } from "amqplib";
import { yellow } from "picocolors";
import { Event, EVENT } from "../../interfaces";
import { Config } from "../Config";
import { rabbitListen, RabbitMQ } from "./RabbitMQ";
import { BaseEventListener } from "./listener/BaseEventListener";
import { BaseEventWriter } from "./writer/BaseEventWriter";
import { UnixSocketWriter } from "./writer/UnixSocketWriter";
import { UnixSocketListener } from "./listener/UnixSocketListener";
import { RabbitMqSingleListener } from "./listener/RabbitMqSingleListener";
import { RabbitMqSingleWriter } from "./writer/RabbitMqSingleWriter";

import { EventWork } from "./EventWork";
import { trackBackground } from "./BackgroundWork";

const eventWork = new EventWork();

export const events = new EventEmitter();
type EmitHook = (payload: Omit<Event, "created_at">) => unknown;
const emitHooks: EmitHook[] = [];
let listener: BaseEventListener | null = null;
let writer: BaseEventWriter | null = null;

export const GuildCacheEventId = "sb-guild-cache";

const guildCacheEvents = new Set<EVENT>([
    "CHANNEL_CREATE",
    "CHANNEL_UPDATE",
    "CHANNEL_DELETE",
    "GUILD_DELETE",
    "GUILD_ROLE_CREATE",
    "GUILD_ROLE_UPDATE",
    "GUILD_ROLE_DELETE",
    "GUILD_EMOJIS_UPDATE",
    "GUILD_STICKERS_UPDATE",
    "VOICE_CHANNEL_STATUS_UPDATE",
]);

async function transmit(id: string, payload: Omit<Event, "created_at">) {
    if (writer) {
        await writer.emit(payload);
    } else if (process.env.EVENT_TRANSMISSION === "process") {
        process.send?.({ type: "event", event: payload, id } as ProcessEvent);
    } else if (RabbitMQ.connection) {
        await RabbitMQ.publishEvent(id, payload);
    } else {
        events.emit(id, payload);
    }
}

export async function emitEvent(payload: Omit<Event, "created_at">) {
    const id = (payload.guild_id || payload.channel_id || payload.user_id || payload.session_id) as string;
    if (!id) return console.error("event doesn't contain any id", payload);

    await transmit(id, payload);
    for (const hook of emitHooks) eventWork.run(() => trackBackground(Promise.resolve(payload).then(hook)));

    const guild_id = guildCacheEvents.has(payload.event) ? (payload.guild_id ?? payload.data?.guild_id) : undefined;
    if (guild_id)
        await transmit(GuildCacheEventId, {
            event: "SB_GUILD_CACHE_INVALIDATE",
            channel_id: GuildCacheEventId,
            data: { guild_id },
        });
}

export function useEventWriter(eventWriter: BaseEventWriter) {
    writer = eventWriter;
}

export function onEmitEvent(hook: EmitHook) {
    emitHooks.push(hook);
}

export async function initEvent() {
    if (process.env.EVENT_TRANSMISSION === "rabbitmq-single") {
        if (!Config.get().rabbitmq.host!) {
            throw new Error("[Events] rabbitmq.host is not configured.");
        }

        if (!writer) {
            writer = new RabbitMqSingleWriter(Config.get().rabbitmq.host!);
            await writer.init();
        }
    } else if (process.env.EVENT_TRANSMISSION === "unix" && process.env.EVENT_SOCKET_PATH) {
        if (!process.env.EVENT_SOCKET_PATH) {
            throw new Error("[Events] EVENT_SOCKET_PATH is not configured.");
        }

        if (!writer) {
            writer = new UnixSocketWriter(process.env.EVENT_SOCKET_PATH);
            await writer.init();
        }
    } else await RabbitMQ.init(); // does nothing if rabbitmq is not setup

    // Set up the spacebar event listener (used for config reload, etc.)
    const setupSpacebarListener = async () => {
        console.log("[Event] Setting up spacebar event listener");
        await listenEvent("spacebar", async (event) => {
            console.log("[Event] Received spacebar event:", event);
            if ((event.event as string) === "SB_RELOAD_CONFIG") {
                console.log("[Event] Reloading config due to RELOAD_CONFIG event");
                await Config.init(true);
            }
        });
    };

    // Initial setup
    await setupSpacebarListener();

    // Re-establish listener on reconnection
    RabbitMQ.on("reconnected", async () => {
        console.log("[Event] RabbitMQ reconnected, re-establishing spacebar listener");
        await setupSpacebarListener();
    });
}

export interface EventOpts extends Event {
    acknowledge?: () => unknown;
    channel?: Channel;
    cancel: (id?: string) => unknown;
}

export interface ListenEventOpts {
    channel?: Channel;
    acknowledge?: boolean;
}

export interface ProcessEvent {
    type: "event";
    event: Event;
    id: string;
}

export async function listenEvent(event: string, callback: (event: EventOpts) => unknown, opts?: ListenEventOpts): Promise<() => Promise<void>> {
    if (process.env.EVENT_TRANSMISSION === "rabbitmq-single") {
        if (!Config.get().rabbitmq.host) {
            throw new Error("[Events] rabbitmq.host is not configured.");
        }
        if (!listener) {
            listener = new RabbitMqSingleListener(Config.get().rabbitmq.host!);
            await listener.init();
        }
        return await listener.listen(event, callback);
    } else if (process.env.EVENT_TRANSMISSION === "unix") {
        if (!process.env.EVENT_SOCKET_PATH) {
            throw new Error("[Events] EVENT_SOCKET_PATH is not configured.");
        }

        if (!listener) {
            listener = new UnixSocketListener(path.join(process.env.EVENT_SOCKET_PATH, `${process.pid}.sock`));
            await listener.init();
        }
        return await listener.listen(event, callback);
    } else if (process.env.EVENT_TRANSMISSION === "process") {
        let cancelled = false;
        const cancel = async () => {
            if (cancelled) return;
            cancelled = true;
            process.removeListener("message", listener);
            process.setMaxListeners(Math.max(0, process.getMaxListeners() - 1));
        };

        const listener = (message: unknown) => {
            const msg = message as ProcessEvent;
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            msg?.type === "event" && msg.id === event && eventWork.run(() => callback({ ...msg.event, cancel }));
        };

        // TODO: assert the type is correct?
        process.addListener("message", listener);
        process.setMaxListeners(process.getMaxListeners() + 1);

        return cancel;
    } else if (RabbitMQ.connection) {
        if (process.env.EVENT_TRANSMISSION !== "rabbitmq-legacy") {
            console.warn(yellow("[Events] Warning:"), "RabbitMQ replication without configuring EVENT_TRANSMISSION is deprecated.");
            console.warn(yellow("[Events] Warning:"), "Set EVENT_TRANSMISSION to 'rabbitmq-legacy' in environment variables to silence this warning.");
        }
        const rabbitMQChannel = await RabbitMQ.getSafeChannel();
        const channel = opts?.channel || rabbitMQChannel;
        if (!channel) throw new Error("[Events] An event was sent without an associated channel");
        return await rabbitListen(channel, event, callback, {
            acknowledge: opts?.acknowledge,
        });
    } else {
        const listener = (opts: EventOpts) => eventWork.run(() => callback({ ...opts, cancel }));
        let cancelled = false;
        const cancel = async () => {
            if (cancelled) return;
            cancelled = true;
            events.removeListener(event, listener);
            events.setMaxListeners(Math.max(0, events.getMaxListeners() - 1));
        };
        events.setMaxListeners(events.getMaxListeners() + 1);
        events.addListener(event, listener);

        return cancel;
    }
}
