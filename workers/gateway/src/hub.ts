import { DurableObject } from "cloudflare:workers";
import { packEtf } from "@spacebar/gateway/util/Etf";
import { databaseConfig } from "../../shared/config";
import { refuseRedirectsInFetch } from "../../shared/fetch";
import { FramedZstd, StatelessDeflate, zstdAvailable } from "./compression";
import { type Attachment, HibernatingSocket } from "./socket";

export interface Env {
    GATEWAY_HUB: DurableObjectNamespace<GatewayHub>;
    HYPERDRIVE: Hyperdrive;
    EVENT_SECRET?: string;
    CONFIG_JSON?: string;
    CONFIG_OVERRIDE?: string;
    CONFIG_TTL_SECONDS?: string;
    JWT_PRIVATE_KEY?: string;
    JWT_PUBLIC_KEY?: string;
    DB_POOL_SIZE?: string;
    DB_LOGGING?: string;
}

export type GatewayEvent = {
    event: string;
    data?: unknown;
    guild_id?: string;
    channel_id?: string;
    user_id?: string;
    session_id?: string;
    [key: string]: unknown;
};

type Listener = (this: HibernatingSocket, ...args: unknown[]) => unknown;
type Runtime = {
    connect: (server: { clients: { size: number } }, socket: HibernatingSocket, request: FakeRequest) => Promise<unknown>;
    remoteAuth: (socket: HibernatingSocket, request: FakeRequest) => unknown;
    emit: (id: string, event: GatewayEvent) => void;
};
type FakeRequest = { url: string; headers: Record<string, string>; socket: { remoteAddress: string } };

refuseRedirectsInFetch();

export const eventTarget = (event: GatewayEvent) => event.guild_id || event.channel_id || event.user_id || event.session_id;

export class GatewayHub extends DurableObject<Env> {
    private sockets = new Map<WebSocket, HibernatingSocket>();
    private runtime?: Promise<Runtime>;
    private config?: ReturnType<typeof databaseConfig>;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        for (const ws of ctx.getWebSockets()) this.reconnectOrphan(ws);
    }

    private start(): Promise<Runtime> {
        this.runtime ??= (async (): Promise<Runtime> => {
            const { JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, DB_POOL_SIZE, DB_LOGGING } = this.env;
            const settings = {
                JWT_PRIVATE_KEY,
                JWT_PUBLIC_KEY,
                DATABASE: this.env.HYPERDRIVE.connectionString,
                APPLY_DB_MIGRATIONS: "false",
                DATABASE_ENTITIES: "bundled",
                STORAGE_LOCATION: "/tmp/meowcord-files",
                DB_POOL_SIZE: DB_POOL_SIZE ?? "5",
                DB_LOGGING: DB_LOGGING ?? "false",
            };
            for (const [key, value] of Object.entries(settings)) if (value !== undefined) process.env[key] = value;
            const database = await import("@spacebar/database");
            const util = await import("@spacebar/util");
            const { compressors } = await import("@spacebar/gateway/util/Compression");
            const { startPresenceSweep } = await import("@spacebar/gateway/util/Utils");
            const connection = await import("@spacebar/gateway/events/Connection");
            const remoteAuth = await import("@spacebar/gateway/events/RemoteAuth");
            compressors.deflate = () => new StatelessDeflate() as never;
            compressors.zstd = () => (zstdAvailable ? (new FramedZstd() as never) : undefined);
            await database.initDatabase();
            this.config = databaseConfig(util.Config, () => database.ConfigEntity.count(), this.env);
            await this.config.load();
            await util.Config.init();
            await util.initEvent();
            await util.JwtKeypairManager.init();
            startPresenceSweep();
            console.log("[Gateway] hub ready");
            return {
                connect: (server, socket, request) => connection.Connection.call(server as never, socket as never, request as never),
                remoteAuth: (socket, request) => remoteAuth.RemoteAuthConnection(socket as never, request as never),
                emit: (id, event) => util.events.emit(id, event),
            };
        })().catch((error) => {
            this.runtime = undefined;
            throw error;
        });
        return this.runtime;
    }

    async reloadConfig() {
        if (!this.runtime) return { reloaded: false };
        await this.start();
        await this.config?.reload();
        return { reloaded: true };
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a websocket upgrade", { status: 426 });
        const runtime = await this.start();
        this.config?.refreshIfStale();
        const url = new URL(request.url);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        const remote = url.pathname.startsWith("/remote-auth");
        const socket = new HibernatingSocket(server, {
            encoding: remote ? "json" : (url.searchParams.get("encoding") ?? "json"),
            compress: remote ? "" : (url.searchParams.get("compress") ?? ""),
            sequence: 0,
            headerSent: false,
            remote,
        } satisfies Attachment);
        this.sockets.set(server, socket);
        socket.on("close", () => this.sockets.delete(server));
        const fakeRequest: FakeRequest = {
            url: `${url.pathname}${url.search}`,
            headers: Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value])),
            socket: { remoteAddress: request.headers.get("cf-connecting-ip") ?? "127.0.0.1" },
        };
        if (remote) runtime.remoteAuth(socket, fakeRequest);
        else {
            Object.assign(socket, { resumeGatewayUrl: `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}` });
            await runtime.connect({ clients: { size: this.sockets.size } }, socket, fakeRequest);
        }
        return new Response(null, { status: 101, webSocket: client });
    }

    async dispatch(events: GatewayEvent[]) {
        if (!this.sockets.size) return { delivered: false };
        const runtime = await this.start();
        this.config?.refreshIfStale();
        for (const event of events) {
            const id = eventTarget(event);
            if (id) runtime.emit(id, event);
        }
        return { delivered: true };
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        const socket = this.sockets.get(ws);
        if (!socket) return this.reconnectOrphan(ws);
        const data = typeof message === "string" ? message : Buffer.from(message);
        await Promise.all(socket.listeners("message").map((listener) => (listener as Listener).call(socket, data)));
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string) {
        this.sockets.get(ws)?.finish(code, reason);
        this.sockets.delete(ws);
        try {
            ws.close(code >= 3000 && code < 5000 ? code : 1000, reason);
        } catch {}
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        const socket = this.sockets.get(ws);
        if (socket?.listenerCount("error")) socket.emit("error", error);
        socket?.finish(1006, "");
        this.sockets.delete(ws);
    }

    private reconnectOrphan(ws: WebSocket) {
        const attachment = ws.deserializeAttachment() as Attachment | null;
        try {
            if (attachment && !attachment.remote) {
                const payload = { op: 7, d: null, s: attachment.sequence };
                let body: string | Buffer = JSON.stringify(payload);
                if (attachment.encoding === "etf") body = packEtf(payload);
                if (attachment.compress === "zlib-stream") body = new StatelessDeflate(attachment.headerSent).process(body);
                else if (attachment.compress === "zstd-stream" && zstdAvailable) body = new FramedZstd().process(body);
                ws.send(body);
            }
            ws.close(4000, "The gateway restarted, reconnect");
        } catch (error) {
            console.error("[Gateway] could not reconnect a socket left from before a restart", error);
        }
    }
}
