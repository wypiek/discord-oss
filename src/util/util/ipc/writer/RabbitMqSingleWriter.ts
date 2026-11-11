import { Channel } from "amqplib";
import { Event } from "@spacebar/util";
import { RabbitMqConnection } from "../RabbitMqConnection";
import { BaseEventWriter } from "./BaseEventWriter";

export class RabbitMqSingleWriter extends BaseEventWriter {
    private static readonly maxQueuedEvents = 1024;
    private static readonly maxQueuedBytes = 16 * 1024 * 1024;
    private readonly transport: RabbitMqConnection;
    private readonly publishing = new Set<Promise<void>>();
    private publication: Promise<void> = Promise.resolve();
    private queuedBytes = 0;
    private closing?: Promise<void>;

    constructor(host: string) {
        super();
        this.transport = new RabbitMqConnection(
            host,
            "RabbitMQSingleWriter",
            (connection) => connection.createChannel(),
            () => this.close(),
            () => Promise.allSettled([...this.publishing]),
        );
    }

    init(): Promise<void> {
        return this.transport.init();
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        const work = this.closeOnce();
        this.closing = work;
        return work;
    }

    private async closeOnce(): Promise<void> {
        await Promise.allSettled([...this.publishing]);
        await this.transport.close();
    }

    emit(event: Event): Promise<void> {
        if (this.closing) return Promise.reject(new Error("Event writer is closing"));
        try {
            if (this.publishing.size >= RabbitMqSingleWriter.maxQueuedEvents) throw this.full();
            const data = JSON.stringify({
                id: event.guild_id || event.channel_id || event.user_id || event.session_id,
                event,
            });
            const bytes = Buffer.byteLength(data);
            if (bytes > RabbitMqSingleWriter.maxQueuedBytes - this.queuedBytes) throw this.full();
            const payload = Buffer.from(data);
            this.queuedBytes += bytes;
            const work = this.publication
                .then(() => this.publish(payload))
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

    private full(): Error {
        return Object.assign(new Error("RabbitMQ event queue capacity exceeded"), {
            code: "IPC_QUEUE_FULL",
        });
    }

    private async publish(payload: Buffer): Promise<void> {
        const channel = this.transport.getChannel();
        await channel.assertExchange("-", "fanout", { durable: false });
        const accepted = channel.publish("-", "", payload, {});
        if (!accepted) await this.waitForDrain(channel);
    }

    private waitForDrain(channel: Channel): Promise<void> {
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
            const failed = (error: Error) => finish(error);
            channel.once("drain", drained);
            channel.once("close", closed);
            channel.once("error", failed);
        });
    }
}
