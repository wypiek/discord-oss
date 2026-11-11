import EventEmitter from "node:events";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import net, { Server, Socket } from "node:net";
import { Gauge } from "prom-client";
import { arraySum } from "@spacebar/extensions";
import { Event, EventOpts } from "@spacebar/util";
import { BaseEventListener } from "./BaseEventListener";
import { ProcessLifecycle } from "../../ProcessLifecycle";
import { Monitoring } from "../../../monitoring/Monitoring";

import { EventWork } from "../EventWork";

export class UnixSocketListener extends BaseEventListener {
    static openConnectionsMetric?: Gauge;
    static openListenersMetric?: Gauge;
    private readonly work = new EventWork();
    private readonly connections = new Set<Socket>();
    private starting?: Promise<void>;
    private closing?: Promise<void>;
    private probe?: Socket;
    private registered = false;
    private closed = false;
    private alias?: { path: string; identity: string };
    eventEmitter: EventEmitter;
    socketPath: string;
    server?: Server;
    isInitialized = false;
    openConnectionsMetric: Gauge.Internal<string>;
    openListenersMetric: Gauge.Internal<string>;

    constructor(socketPath: string) {
        super();
        this.eventEmitter = new EventEmitter();
        this.socketPath = socketPath;
        UnixSocketListener.openConnectionsMetric = Monitoring.attachMetric(
            "spacebar_ipc_unix_listener_open_connection_count",
            new Gauge({
                name: "spacebar_ipc_unix_listener_open_connection_count",
                help: "Amount of open inbound connections on unix socket",
                labelNames: ["path"],
                registers: [],
            }),
        );
        this.openConnectionsMetric = UnixSocketListener.openConnectionsMetric.labels({
            path: socketPath,
        });
        UnixSocketListener.openListenersMetric = Monitoring.attachMetric(
            "spacebar_ipc_unix_listener_open_listener_count",
            new Gauge({
                name: "spacebar_ipc_unix_listener_open_listener_count",
                help: "Amount of open listeners on unix socket",
                labelNames: ["path"],
                registers: [],
            }),
        );
        this.openListenersMetric = UnixSocketListener.openListenersMetric.labels({ path: socketPath });
    }

    init(): Promise<void> {
        if (this.closed || ProcessLifecycle.shutdownRequested || this.isInitialized) return Promise.resolve();
        if (this.starting) return this.starting;
        if (!this.registered) {
            this.registered = true;
            ProcessLifecycle.eventEmitter.on("stopped", () => this.close());
        }
        const work = this.start().finally(() => {
            this.starting = undefined;
        });
        this.starting = work;
        return work;
    }

    private identity(file: string): string | undefined {
        try {
            const stat = fs.lstatSync(file, { bigint: true });
            return stat.isSocket() ? `${stat.dev}:${stat.ino}` : undefined;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw error;
        }
    }

    private async preparePath() {
        const identity = this.identity(this.socketPath);
        if (!identity) return;
        await new Promise<void>((resolve, reject) => {
            const probe = net.createConnection(this.socketPath);
            this.probe = probe;
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.probe = undefined;
                probe.destroy();
                if (error) reject(error);
                else resolve();
            };
            const occupied = () => Object.assign(new Error("Unix socket path is in use"), { code: "EADDRINUSE" });
            const timer = setTimeout(() => finish(occupied()), 1000).unref();
            probe.once("connect", () => finish(occupied()));
            probe.on("error", (error: NodeJS.ErrnoException) => {
                finish(error.code === "ECONNREFUSED" || error.code === "ENOENT" ? undefined : error);
            });
            probe.once("close", () => finish(this.closed ? undefined : occupied()));
        });
        if (!this.closed && this.identity(this.socketPath) === identity) fs.unlinkSync(this.socketPath);
    }

    private async start() {
        try {
            await this.preparePath();
            if (this.closed || ProcessLifecycle.shutdownRequested) return;
            const nameLength = Math.min(12, Buffer.byteLength(path.basename(this.socketPath)));
            const name = randomBytes(9).toString("base64url");
            const boundName = nameLength === 1 ? name[0] : `.${name.slice(0, nameLength - 1)}`;
            const boundPath = path.join(path.dirname(this.socketPath), boundName);
            const server = (this.server = net.createServer((socket) => this.accept(socket)));
            server.on("error", () => console.error("[UnixSocketListener] Socket server failed"));
            await new Promise<void>((resolve, reject) => {
                const ready = () => {
                    server.off("error", failed);
                    resolve();
                };
                const failed = (error: Error) => {
                    server.off("listening", ready);
                    reject(error);
                };
                server.once("listening", ready);
                server.once("error", failed);
                server.listen(boundPath);
            });
            if (this.closed || ProcessLifecycle.shutdownRequested) return;
            fs.linkSync(boundPath, this.socketPath);
            const identity = this.identity(this.socketPath);
            if (!identity) throw new Error("Unix socket discovery path is missing");
            this.alias = { path: this.socketPath, identity };
            this.isInitialized = true;
        } catch (error) {
            await this.closeServer();
            this.removeAlias();
            throw error;
        }
    }

    private accept(socket: Socket) {
        if (this.closed || ProcessLifecycle.shutdownRequested) {
            socket.destroy();
            return;
        }
        this.connections.add(socket);
        this.openConnectionsMetric.set(this.connections.size);
        let buffer = Buffer.alloc(0);
        socket.on("data", (data: Buffer) => {
            if (this.closed) return;
            buffer = Buffer.concat([buffer, data]);
            while (!this.closed && buffer.length >= 4) {
                const length = buffer.readUInt32BE();
                if (buffer.length < 4 + length) break;
                const message = buffer.subarray(4, 4 + length);
                buffer = buffer.subarray(4 + length);
                try {
                    const payload = JSON.parse(message.toString()) as { id: string; event: Event };
                    this.eventEmitter.emit(payload.id, payload.event);
                } catch {
                    console.error("[UnixSocketListener] Event delivery failed");
                }
            }
        });
        socket.on("error", () => console.error("[UnixSocketListener] Socket client failed"));
        socket.on("close", () => {
            buffer = Buffer.alloc(0);
            this.connections.delete(socket);
            if (!this.closed) this.openConnectionsMetric.set(this.connections.size);
        });
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closed = true;
        this.probe?.destroy();
        const work = this.closeOnce();
        this.closing = work;
        return work;
    }

    private async closeOnce() {
        await this.starting?.catch(() => {});
        for (const socket of this.connections) socket.destroy();
        await this.closeServer();
        this.connections.clear();
        this.removeAlias();
        await this.work.close();
        this.eventEmitter.removeAllListeners();
        this.eventEmitter.setMaxListeners(10);
        this.isInitialized = false;
        UnixSocketListener.openConnectionsMetric?.remove({ path: this.socketPath });
        UnixSocketListener.openListenersMetric?.remove({ path: this.socketPath });
    }

    private closeServer(): Promise<void> {
        const server = this.server;
        if (!server) return Promise.resolve();
        return new Promise((resolve, reject) => {
            server.close((error?: NodeJS.ErrnoException) => {
                if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
                else resolve();
            });
        });
    }

    private removeAlias() {
        if (!this.alias) return;
        if (this.identity(this.alias.path) === this.alias.identity) fs.unlinkSync(this.alias.path);
        this.alias = undefined;
    }

    async listen(event: string, callback: (event: EventOpts) => unknown): Promise<() => Promise<void>> {
        if (this.closed) throw new Error("Event listener is closing");
        let cancelled = false;
        const listener = (data: Event) => this.work.run(() => callback({ ...data, cancel }));
        const cancel = async () => {
            if (cancelled) return;
            cancelled = true;
            this.eventEmitter.removeListener(event, listener);
            this.eventEmitter.setMaxListeners(Math.max(10, this.eventEmitter.getMaxListeners() - 1));
            if (!this.closed) this.openListenersMetric.set(arraySum(this.eventEmitter.eventNames().map((name) => this.eventEmitter.listenerCount(name))));
        };
        this.eventEmitter.addListener(event, listener);
        this.eventEmitter.setMaxListeners(this.eventEmitter.getMaxListeners() + 1);
        this.openListenersMetric.set(arraySum(this.eventEmitter.eventNames().map((name) => this.eventEmitter.listenerCount(name))));
        return cancel;
    }
}
