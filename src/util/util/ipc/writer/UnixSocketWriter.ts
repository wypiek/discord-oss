import net, { Socket } from "node:net";
import fs, { FSWatcher } from "node:fs";
import path from "node:path";
import { Gauge } from "prom-client";
import { Event } from "@spacebar/util";
import { Monitoring } from "../../../monitoring/Monitoring";
import { ProcessLifecycle } from "../../ProcessLifecycle";
import { BaseEventWriter } from "./BaseEventWriter";

interface ConnectionAttempt {
    identity: string;
    cancelled: boolean;
    ready: boolean;
    socket?: Socket;
    timer?: ReturnType<typeof setTimeout>;
    release?: () => void;
    work?: Promise<void>;
}

export class UnixSocketWriter extends BaseEventWriter {
    private static openConnectionsMetric: Gauge;
    private static readonly maxQueuedEvents = 1024;
    private static readonly maxQueuedBytes = 16 * 1024 * 1024;
    private readonly reserved = new Set<Buffer>();
    private queuedBytes = 0;
    private flushing?: Promise<void>;
    private readonly connections = new Map<string, ConnectionAttempt>();
    private readonly identities = new Map<string, string>();
    private readonly publishing = new Set<Promise<void>>();
    private stopping = false;
    private initialized = false;
    private closing?: Promise<void>;
    socketPath: string;
    clients: { [key: string]: Socket } = {};
    watcher?: FSWatcher;
    backlog: Buffer[] = [];
    broadcastLock: Promise<void> = Promise.resolve();
    openConnectionsMetric: Gauge.Internal<string>;

    constructor(socketPath: string) {
        super();
        this.socketPath = socketPath;
        UnixSocketWriter.openConnectionsMetric = Monitoring.attachMetric(
            "spacebar_ipc_unix_writer_open_connection_count",
            new Gauge({
                name: "spacebar_ipc_unix_writer_open_connection_count",
                help: "Amount of open outbound connections on unix socket",
                labelNames: ["path"],
                registers: [],
            }),
        );
        this.openConnectionsMetric = UnixSocketWriter.openConnectionsMetric.labels({
            path: socketPath,
        });
    }

    async init(): Promise<void> {
        if (this.initialized || this.stopping || ProcessLifecycle.shutdownRequested) return;
        if (!fs.statSync(this.socketPath).isDirectory()) throw new Error("Unix socket path is not a directory");
        this.watcher = fs.watch(this.socketPath, (event, file) => {
            if (this.stopping || (event !== "rename" && event !== "change") || !file?.endsWith(".sock")) return;
            const fullPath = path.join(this.socketPath, file);
            if (this.socketIdentity(fullPath)) this.connect(file);
            else {
                this.cancelAttempt(this.connections.get(fullPath));
                const socket = this.clients[fullPath];
                delete this.clients[fullPath];
                this.identities.delete(fullPath);
                socket?.destroy();
                this.updateMetric();
            }
        });
        this.watcher.on("error", () => console.error("[UnixSocketWriter] Socket watcher failed"));
        this.watcher.unref();
        this.initialized = true;
        ProcessLifecycle.eventEmitter.on("shutdownRequested", () => this.cancel());
        ProcessLifecycle.eventEmitter.on("stopping", async () => {
            this.cancel();
            await this.drain();
        });
        ProcessLifecycle.eventEmitter.on("stopped", () => this.close());
        for (const file of fs.readdirSync(this.socketPath).sort()) if (file.endsWith(".sock")) this.connect(file);
    }

    private socketIdentity(fullPath: string): string | undefined {
        try {
            const stat = fs.statSync(fullPath, { bigint: true });
            return stat.isSocket() ? `${stat.dev}:${stat.ino}` : undefined;
        } catch {
            return undefined;
        }
    }

    private connect(file: string, delay = 0) {
        if (this.stopping || ProcessLifecycle.shutdownRequested) return;
        const fullPath = path.join(this.socketPath, file);
        const identity = this.socketIdentity(fullPath);
        if (!identity) return;
        const active = this.connections.get(fullPath);
        if (active && !active.cancelled && active.identity === identity) return;
        const socket = this.clients[fullPath];
        if (socket && !socket.destroyed && this.identities.get(fullPath) === identity) return;
        this.cancelAttempt(active);
        delete this.clients[fullPath];
        socket?.destroy();
        const attempt: ConnectionAttempt = { identity, cancelled: false, ready: false };
        this.connections.set(fullPath, attempt);
        attempt.work = this.connectUntilReady(file, fullPath, attempt, delay).finally(() => {
            if (this.connections.get(fullPath) === attempt) this.connections.delete(fullPath);
        });
    }

    private async connectUntilReady(file: string, fullPath: string, attempt: ConnectionAttempt, delay: number) {
        for (let tries = 1; tries <= 10; tries++) {
            if (delay) await this.wait(attempt, delay);
            if (this.stopping || attempt.cancelled || ProcessLifecycle.shutdownRequested) return;
            if (this.socketIdentity(fullPath) !== attempt.identity) {
                this.connect(file);
                return;
            }
            try {
                await this.open(file, fullPath, attempt);
                return;
            } catch {
                if (this.stopping || attempt.cancelled || ProcessLifecycle.shutdownRequested) return;
                delay = (tries + 1) ** 3.5;
            }
        }
        console.error("[UnixSocketWriter] Socket connection attempts exhausted");
    }

    private open(file: string, fullPath: string, attempt: ConnectionAttempt): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(fullPath);
            attempt.socket = socket;
            this.clients[fullPath] = socket;
            this.identities.set(fullPath, attempt.identity);
            socket.once("connect", () => {
                if (this.stopping || attempt.cancelled || this.clients[fullPath] !== socket) {
                    socket.destroy();
                    resolve();
                    return;
                }
                attempt.ready = true;
                this.updateMetric();
                resolve();
                void this.flush().catch(() => console.error("[UnixSocketWriter] Backlog delivery failed"));
            });
            socket.on("error", () => {
                if (!attempt.ready) reject(new Error("Socket connection failed"));
            });
            socket.on("close", () => {
                if (!attempt.ready) reject(new Error("Socket closed before connection"));
                if (this.clients[fullPath] !== socket) return;
                delete this.clients[fullPath];
                this.identities.delete(fullPath);
                this.updateMetric();
                if (attempt.ready && !this.stopping) void attempt.work?.then(() => this.connect(file, 1000));
            });
        });
    }

    private wait(attempt: ConnectionAttempt, delay: number): Promise<void> {
        return new Promise((resolve) => {
            attempt.release = resolve;
            attempt.timer = setTimeout(() => {
                attempt.timer = undefined;
                attempt.release = undefined;
                resolve();
            }, delay).unref();
        });
    }

    private cancelAttempt(attempt?: ConnectionAttempt) {
        if (!attempt) return;
        attempt.cancelled = true;
        clearTimeout(attempt.timer);
        attempt.timer = undefined;
        attempt.release?.();
        attempt.release = undefined;
        if (!attempt.ready) attempt.socket?.destroy();
    }

    private cancel() {
        this.stopping = true;
        this.watcher?.close();
        this.watcher = undefined;
        for (const attempt of this.connections.values()) this.cancelAttempt(attempt);
    }

    private updateMetric() {
        if (!this.closing) this.openConnectionsMetric.set(Object.values(this.clients).filter((socket) => !socket.destroyed && !socket.connecting).length);
    }

    emit(event: Event): Promise<void> {
        if (this.closing) return Promise.reject(new Error("Event writer is closing"));
        try {
            if (this.reserved.size >= UnixSocketWriter.maxQueuedEvents) throw this.full();
            const data = JSON.stringify({
                id: event.guild_id || event.channel_id || event.user_id || event.session_id,
                event,
            });
            const bytes = Buffer.byteLength(data) + 4;
            if (bytes > UnixSocketWriter.maxQueuedBytes - this.queuedBytes) throw this.full();
            const framed = Buffer.allocUnsafe(bytes);
            framed.writeUInt32BE(bytes - 4);
            framed.write(data, 4, "utf8");
            this.reserved.add(framed);
            this.queuedBytes += bytes;
            return this.enqueue(framed);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    private full(): Error {
        return Object.assign(new Error("Unix event queue capacity exceeded"), {
            code: "IPC_QUEUE_FULL",
        });
    }

    private release(framed: Buffer) {
        if (!this.reserved.delete(framed)) return;
        this.queuedBytes -= framed.length;
    }

    private flush(): Promise<void> {
        if (this.flushing) return this.flushing;
        if (!this.backlog.length) return Promise.resolve();
        this.flushing = this.enqueue().finally(() => {
            this.flushing = undefined;
        });
        return this.flushing;
    }

    private enqueue(framed?: Buffer): Promise<void> {
        if (this.closing) {
            if (framed) this.release(framed);
            return Promise.reject(new Error("Event writer is closing"));
        }
        const work = this.broadcastLock.then(() => this.publish(framed)).finally(() => this.publishing.delete(work));
        this.broadcastLock = work.catch(() => {});
        this.publishing.add(work);
        return work;
    }

    private async publish(framed?: Buffer) {
        const sockets = Object.values(this.clients).filter((socket) => !socket.destroyed);
        if (!sockets.length) {
            if (framed) {
                if (this.stopping || ProcessLifecycle.shutdownRequested) {
                    this.release(framed);
                    throw new Error("Event writer has no connected listeners");
                }
                this.backlog.push(framed);
            }
            return;
        }
        const pending = this.backlog.splice(0);
        if (framed) pending.push(framed);
        try {
            for (const payload of pending) {
                await Promise.all(sockets.map((socket) => this.write(socket, payload).catch(() => console.error("[UnixSocketWriter] Socket delivery failed"))));
                this.release(payload);
            }
        } finally {
            for (const payload of pending) this.release(payload);
        }
    }

    private write(socket: Socket, framed: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                socket.off("close", closed);
                socket.off("error", failed);
                if (error) reject(error);
                else resolve();
            };
            const closed = () => finish(new Error("Socket closed before its write completed"));
            const failed = () => finish(new Error("Socket failed before its write completed"));
            socket.once("close", closed);
            socket.once("error", failed);
            try {
                socket.write(framed, (error) => finish(error ? new Error("Socket write failed") : undefined));
            } catch {
                failed();
            }
        });
    }

    private async drain() {
        await Promise.allSettled([...this.connections.values()].map((attempt) => attempt.work));
        await Promise.allSettled([...this.publishing]);
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        const work = this.closeOnce();
        this.closing = work;
        return work;
    }

    private async closeOnce() {
        this.cancel();
        await this.drain();
        const sockets = Object.values(this.clients);
        this.clients = {};
        this.identities.clear();
        for (const socket of sockets) socket.destroy();
        this.backlog = [];
        this.reserved.clear();
        this.queuedBytes = 0;
        UnixSocketWriter.openConnectionsMetric.remove({ path: this.socketPath });
    }
}
