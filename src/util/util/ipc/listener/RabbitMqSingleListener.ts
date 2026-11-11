import EventEmitter from "node:events";
import { randomUUID } from "node:crypto";
import { Channel, ChannelModel } from "amqplib";
import { Gauge } from "prom-client";
import { arraySum } from "@spacebar/extensions";
import { Event, EventOpts } from "@spacebar/util";
import { Monitoring } from "../../../monitoring/Monitoring";
import { RabbitMqConnection } from "../RabbitMqConnection";
import { BaseEventListener } from "./BaseEventListener";

import { EventWork } from "../EventWork";

export class RabbitMqSingleListener extends BaseEventListener {
    static openListenersMetric: Gauge;
    private readonly work = new EventWork();
    private readonly host: string;
    private readonly transport: RabbitMqConnection;
    private closing?: Promise<void>;
    eventEmitter: EventEmitter;
    openListenersMetric: Gauge.Internal<string>;

    constructor(host: string) {
        super();
        this.eventEmitter = new EventEmitter();
        const metricHost = new URL(host);
        metricHost.username = "";
        metricHost.password = "";
        this.host = metricHost.toString();
        this.transport = new RabbitMqConnection(
            host,
            "RabbitMQSingleListener",
            (connection) => this.setup(connection),
            () => this.close(),
        );

        RabbitMqSingleListener.openListenersMetric = Monitoring.attachMetric(
            "spacebar_ipc_unix_listener_open_listener_count",
            new Gauge({
                name: "spacebar_ipc_rabbitmqsingle_listener_open_listener_count",
                help: "Amount of open listeners on unix socket",
                labelNames: ["host"],
                registers: [],
            }),
        );
        this.openListenersMetric = RabbitMqSingleListener.openListenersMetric.labels({
            host: this.host,
        });
    }

    init(): Promise<void> {
        return this.transport.init();
    }

    private async setup(connection: ChannelModel): Promise<Channel> {
        const channel = await connection.createChannel();
        await channel.assertExchange("-", "fanout", { durable: false });
        const q = await channel.assertQueue("", {
            durable: false,
            exclusive: true,
            autoDelete: true,
            messageTtl: 5000,
        });

        const consumerTag = randomUUID();
        await channel.bindQueue(q.queue, "-", "");
        await channel.consume(
            q.queue,
            (opts) => {
                if (!opts) return;
                let data: { id: string; event: Event };
                try {
                    data = JSON.parse(opts.content.toString());
                    if (
                        !data ||
                        typeof data.id !== "string" ||
                        !data.id ||
                        !data.event ||
                        typeof data.event !== "object" ||
                        Array.isArray(data.event) ||
                        typeof data.event.event !== "string" ||
                        !data.event.event
                    )
                        throw new Error("Invalid event delivery");
                } catch {
                    channel.reject(opts, false);
                    console.error("[RabbitMQSingleListener] Rejected malformed event delivery");
                    return;
                }
                try {
                    this.eventEmitter.emit(data.id, data.event);
                } catch {
                    console.error("[RabbitMQSingleListener] Event listener failed");
                } finally {
                    channel.ack(opts);
                }
            },
            {
                consumerTag,
            },
        );
        return channel;
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        const work = this.work
            .close()
            .then(() => this.transport.close())
            .then(() => {
                RabbitMqSingleListener.openListenersMetric.remove({ host: this.host });
            });
        this.closing = work;
        return work;
    }

    async listen(event: string, callback: (event: EventOpts) => unknown): Promise<() => Promise<void>> {
        const listener = (data: Event) => {
            this.work.run(() =>
                callback({
                    ...data,
                    cancel,
                }),
            );
        };

        this.eventEmitter.addListener(event, listener);
        this.openListenersMetric.set(arraySum(this.eventEmitter.eventNames().map((e) => this.eventEmitter.listeners(e).length)));

        const cancel = async () => {
            this.eventEmitter.removeListener(event, listener);
            this.eventEmitter.setMaxListeners(this.eventEmitter.getMaxListeners() - 1);
            this.openListenersMetric.set(arraySum(this.eventEmitter.eventNames().map((e) => this.eventEmitter.listeners(e).length)));
        };

        this.eventEmitter.setMaxListeners(this.eventEmitter.getMaxListeners() + 1);

        return cancel;
    }
}
