import amqp, { Channel, ChannelModel } from "amqplib";
import { ProcessLifecycle } from "../ProcessLifecycle";

export class RabbitMqConnection {
    private connection?: ChannelModel;
    private channel?: Channel;
    private connecting?: Promise<void>;
    private closing?: Promise<void>;
    private controller?: AbortController;
    private timer?: ReturnType<typeof setTimeout>;
    private releaseDelay?: () => void;
    private stopping = false;
    private registered = false;

    constructor(
        private readonly host: string,
        private readonly label: string,
        private readonly setup: (connection: ChannelModel) => Promise<Channel>,
        private readonly finalize: () => Promise<void>,
        private readonly drain: () => Promise<unknown> = async () => {},
    ) {}

    init(delay = false): Promise<void> {
        if (this.stopping || ProcessLifecycle.shutdownRequested) return Promise.resolve();
        if (!this.registered) {
            this.registered = true;
            ProcessLifecycle.eventEmitter.on("shutdownRequested", () => this.cancel());
            ProcessLifecycle.eventEmitter.on("stopping", async () => {
                this.cancel();
                await this.connecting;
                await this.drain();
            });
            ProcessLifecycle.eventEmitter.on("stopped", this.finalize);
        }
        if (this.connecting) return this.connecting;
        if (this.connection && this.channel) return Promise.resolve();
        const work = this.connectUntilReady(delay).finally(() => {
            this.connecting = undefined;
        });
        this.connecting = work;
        return work;
    }

    getChannel(): Channel {
        if (!this.channel) throw new Error(`${this.label} has no active channel`);
        return this.channel;
    }

    private cancel() {
        this.stopping = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.releaseDelay?.();
        this.releaseDelay = undefined;
        this.controller?.abort();
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        const work = this.closeOnce();
        this.closing = work;
        return work;
    }

    private async closeOnce() {
        this.cancel();
        await this.connecting;
        const channel = this.channel;
        const connection = this.connection;
        this.channel = undefined;
        this.connection = undefined;
        await channel?.close().catch(() => {});
        await connection?.close();
    }

    private wait(): Promise<void> {
        return new Promise((resolve) => {
            this.releaseDelay = resolve;
            this.timer = setTimeout(() => {
                this.timer = undefined;
                this.releaseDelay = undefined;
                resolve();
            }, 1_000).unref();
        });
    }

    private async connectUntilReady(delay: boolean) {
        while (!this.stopping && !ProcessLifecycle.shutdownRequested) {
            if (delay) await this.wait();
            if (this.stopping || ProcessLifecycle.shutdownRequested) return;
            const controller = new AbortController();
            this.controller = controller;
            let connection: ChannelModel | undefined;
            try {
                console.log(`[${this.label}] Connecting`);
                const socketOptions = { timeout: 60_000, noDelay: true, signal: controller.signal };
                connection = await amqp.connect(this.host, socketOptions);
                if (this.stopping || ProcessLifecycle.shutdownRequested) {
                    await connection.close();
                    return;
                }
                this.connection = connection;
                this.attach(connection);
                const channel = await this.setup(connection);
                if (this.connection !== connection) {
                    await channel.close().catch(() => {});
                    delay = true;
                    continue;
                }
                this.channel = channel;
                channel.on("error", () => console.error(`[${this.label}] Channel error`));
                channel.on("close", () => {
                    if (this.channel !== channel) return;
                    this.channel = undefined;
                    void connection!.close().catch(() => {});
                });
                if (this.stopping || ProcessLifecycle.shutdownRequested) return;
                console.log(`[${this.label}] Connected`);
                return;
            } catch {
                if (this.connection === connection) {
                    this.connection = undefined;
                    this.channel = undefined;
                }
                await connection?.close().catch(() => {});
                if (this.stopping || ProcessLifecycle.shutdownRequested) return;
                console.error(`[${this.label}] Connection failed; retrying`);
                delay = true;
            } finally {
                if (this.controller === controller) this.controller = undefined;
            }
        }
    }

    private attach(connection: ChannelModel) {
        connection.on("error", () => console.error(`[${this.label}] Connection error`));
        connection.on("close", () => {
            if (this.connection !== connection) return;
            this.connection = undefined;
            this.channel = undefined;
            if (this.stopping || ProcessLifecycle.shutdownRequested) return;
            console.error(`[${this.label}] Connection closed`);
            void this.init(true).catch(() => console.error(`[${this.label}] Reconnection failed`));
        });
    }
}
