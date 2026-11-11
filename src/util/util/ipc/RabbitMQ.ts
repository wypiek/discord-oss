import { randomUUID } from "node:crypto";
import { EventWork } from "./EventWork";
import EventEmitter from "node:events";
import amqp, { Channel, ChannelModel } from "amqplib";
import { Event, EVENT } from "../../interfaces";
import { Config } from "../Config";
import type { EventOpts } from "./Event";
import { ProcessLifecycle } from "../ProcessLifecycle";

export class RabbitMQ {
    public static connection: ChannelModel | null = null;
    public static channel: Channel | null = null;

    private static events = new EventEmitter();
    private static isReconnecting = false;
    private static stopping = false;
    private static lifecycleRegistered = false;
    private static connecting?: Promise<void>;
    private static connectionController?: AbortController;
    private static reconnectTimer?: ReturnType<typeof setTimeout>;
    private static releaseReconnect?: () => void;
    private static readonly maxQueuedEvents = 1024;
    private static readonly maxQueuedBytes = 16 * 1024 * 1024;
    private static readonly publishing = new Set<Promise<void>>();
    private static publication: Promise<void> = Promise.resolve();
    private static queuedBytes = 0;
    private static closing?: Promise<void>;
    private static readonly BASE_RECONNECT_DELAY_MS = 500;

    static on(event: "reconnected" | "disconnected", listener: () => void) {
        this.events.on(event, listener);
    }

    static off(event: "reconnected" | "disconnected", listener: () => void) {
        this.events.off(event, listener);
    }

    static async init() {
        const host = Config.get().rabbitmq.host;
        if (!host || this.stopping || ProcessLifecycle.shutdownRequested) return;
        this.installLifecycleListeners();
        await this.connect(host);
    }

    private static installLifecycleListeners() {
        if (this.lifecycleRegistered) return;
        this.lifecycleRegistered = true;
        ProcessLifecycle.eventEmitter.on("shutdownRequested", () => this.cancelReconnect());
        ProcessLifecycle.eventEmitter.on("stopping", async () => await this.stopReconnecting());
        ProcessLifecycle.eventEmitter.on("stopped", async () => await this.close());
    }

    private static connect(host: string, delay = false): Promise<void> {
        if (this.stopping || ProcessLifecycle.shutdownRequested) return Promise.resolve();
        if (this.connecting) return this.connecting;
        if (this.connection) return Promise.resolve();
        const work = this.connectUntilReady(host, delay).finally(() => {
            this.connecting = undefined;
            this.isReconnecting = false;
        });
        this.connecting = work;
        return work;
    }

    private static async connectUntilReady(host: string, delay: boolean) {
        this.isReconnecting = true;
        while (!this.stopping && !ProcessLifecycle.shutdownRequested) {
            if (delay) await this.waitForReconnect();
            if (this.stopping || ProcessLifecycle.shutdownRequested) return;
            const controller = new AbortController();
            this.connectionController = controller;
            let connection: ChannelModel | undefined;
            try {
                console.log("[RabbitMQ] Connecting");
                const socketOptions = { timeout: 60_000, signal: controller.signal };
                connection = await amqp.connect(host, socketOptions);
                if (this.stopping || ProcessLifecycle.shutdownRequested) {
                    await connection.close();
                    return;
                }
                this.connection = connection;
                this.attachConnectionListeners(connection, host);
                await this.getSafeChannel();
                if (this.stopping || ProcessLifecycle.shutdownRequested) return;
                this.isReconnecting = false;
                console.log("[RabbitMQ] Connected successfully");
                this.events.emit("reconnected");
                if (this.connection === connection) return;
                this.isReconnecting = true;
                delay = true;
            } catch {
                if (this.connection === connection) {
                    this.connection = null;
                    this.channel = null;
                }
                await connection?.close().catch(() => {});
                if (this.stopping || ProcessLifecycle.shutdownRequested) return;
                console.error("[RabbitMQ] Connection failed; retrying");
                delay = true;
            } finally {
                if (this.connectionController === controller) this.connectionController = undefined;
            }
        }
    }

    private static waitForReconnect(): Promise<void> {
        return new Promise((resolve) => {
            this.releaseReconnect = resolve;
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = undefined;
                this.releaseReconnect = undefined;
                resolve();
            }, this.BASE_RECONNECT_DELAY_MS).unref();
        });
    }

    private static attachConnectionListeners(connection: ChannelModel, host: string) {
        connection.on("error", () => console.error("[RabbitMQ] Connection error"));
        connection.on("close", () => {
            if (this.connection !== connection) return;
            this.channel = null;
            this.connection = null;
            if (this.stopping || ProcessLifecycle.shutdownRequested) return;
            console.error("[RabbitMQ] Connection closed");
            this.events.emit("disconnected");
            void this.connect(host, true).catch(() => console.error("[RabbitMQ] Reconnection failed"));
        });
    }

    private static cancelReconnect() {
        this.stopping = true;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.releaseReconnect?.();
        this.releaseReconnect = undefined;
        this.connectionController?.abort();
    }

    static async stopReconnecting() {
        this.cancelReconnect();
        await this.connecting;
        await Promise.allSettled([...this.publishing]);
    }

    static close(): Promise<void> {
        if (this.closing) return this.closing;
        const work = this.closeOnce();
        this.closing = work;
        return work;
    }

    private static async closeOnce() {
        await this.stopReconnecting();
        const channel = this.channel;
        const connection = this.connection;
        this.channel = null;
        this.connection = null;
        await channel?.close().catch(() => {});
        await connection?.close();
    }

    static async getSafeChannel(): Promise<Channel> {
        if (!this.connection) {
            return Promise.reject(new Error("[RabbitMQ] No connection available"));
        }

        // Check if cached channel is still usable
        if (this.channel) {
            // amqplib channels have a 'closed' property when closed
            const isClosed = (this.channel as unknown as { closed?: boolean }).closed;
            if (!isClosed) {
                return this.channel;
            }
            console.log("[RabbitMQ] Cached channel is closed, creating new one");
            this.channel = null;
        }

        try {
            this.channel = await this.connection.createChannel();
            console.log("[RabbitMQ] Channel created");

            this.channel.on("error", (err) => {
                console.error("[RabbitMQ] Channel error:", err);
            });

            const channel = this.channel;
            channel.on("close", () => {
                console.log("[RabbitMQ] Channel closed");
                if (this.channel === channel) this.channel = null;
            });

            return this.channel;
        } catch (e) {
            console.error("[RabbitMQ] Failed to create channel:", e);
            this.channel = null;
            throw e;
        }
    }

    /**
     * Check if RabbitMQ is currently connected and ready.
     */
    static isConnected(): boolean {
        return this.connection !== null && !this.isReconnecting;
    }

    static publishEvent(id: string, payload: Omit<Event, "created_at">): Promise<void> {
        if (this.closing) return Promise.reject(new Error("Event writer is closing"));
        try {
            if (this.publishing.size >= this.maxQueuedEvents) throw this.full();
            const data = `${typeof payload.data === "object" ? JSON.stringify(payload.data) : payload.data}`;
            const bytes = Buffer.byteLength(data);
            if (bytes > this.maxQueuedBytes - this.queuedBytes) throw this.full();
            const encoded = Buffer.from(data);
            const event = payload.event;
            this.queuedBytes += bytes;
            const work = this.publication
                .then(() => this.publish(id, event, encoded))
                .finally(() => {
                    this.queuedBytes -= bytes;
                    this.publishing.delete(work);
                });
            this.publication = work.catch(() => {});
            this.publishing.add(work);
            return work;
        } catch (error) {
            return Promise.reject(error);
        }
    }

    private static full(): Error {
        return Object.assign(new Error("RabbitMQ event queue capacity exceeded"), {
            code: "IPC_QUEUE_FULL",
        });
    }

    private static async publish(id: string, event: string, payload: Buffer): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            const channel = await this.getSafeChannel();
            let published = false;
            try {
                await channel.assertExchange(id, "fanout", { durable: false });
                const accepted = channel.publish(id, "", payload, { type: event });
                published = true;
                if (!accepted) await this.waitForDrain(channel);
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const channelFailed = message.includes("Channel closed") || message.includes("IllegalOperationError") || message.includes("RESOURCE_ERROR");
                if (published || attempt >= 1 || !channelFailed) throw error;
                if (this.channel === channel) this.channel = null;
            }
        }
    }

    private static waitForDrain(channel: Channel): Promise<void> {
        return new Promise((resolve, reject) => {
            const finish = (error?: Error) => {
                channel.off("drain", drained);
                channel.off("close", closed);
                channel.off("error", failed);
                if (error) reject(error);
                else resolve();
            };
            const drained = () => finish();
            const closed = () => finish(new Error("Event channel closed before its buffer drained"));
            const failed = () => finish(new Error("Event channel failed before its buffer drained"));
            channel.once("drain", drained);
            channel.once("close", closed);
            channel.once("error", failed);
        });
    }
}

export async function rabbitListen(channel: Channel, id: string, callback: (event: EventOpts) => unknown, opts?: { acknowledge?: boolean }): Promise<() => Promise<void>> {
    const work = new EventWork();
    await channel.assertExchange(id, "fanout", { durable: false });
    const q = await channel.assertQueue("", {
        exclusive: true,
        autoDelete: true,
        messageTtl: 5000,
    });

    const consumerTag = randomUUID();

    const cancel = async () => {
        try {
            await channel.unbindQueue(q.queue, id, "");
            await channel.cancel(consumerTag);
        } catch (e) {
            console.log("[RabbitMQ] Error while cancelling channel (may be expected):", e instanceof Error ? e.message : e);
        }
    };

    await channel.bindQueue(q.queue, id, "");
    await channel.consume(
        q.queue,
        (opts) => {
            if (!opts) return;

            const data = JSON.parse(opts.content.toString());
            const event = opts.properties.type as EVENT;

            work.run(() =>
                callback({
                    event,
                    data,
                    acknowledge() {
                        channel.ack(opts);
                    },
                    channel,
                    cancel,
                }),
            );
            // rabbitCh.ack(opts);
        },
        {
            noAck: !opts?.acknowledge,
            consumerTag: consumerTag,
        },
    );

    return cancel;
}
