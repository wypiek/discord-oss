import { EventEmitter } from "node:events";

export type Attachment = {
    encoding: string;
    compress: string;
    sequence: number;
    headerSent: boolean;
    user_id?: string;
    session_id?: string;
    remote?: boolean;
};

type SocketFields = { sequence?: number; user_id?: string; session_id?: string; encoding?: string; compress?: string; deflate?: { headerSent?: boolean } };

export class HibernatingSocket extends EventEmitter {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly bufferedAmount = 0;
    closed = false;
    private persistQueued = false;

    constructor(
        readonly raw: WebSocket,
        private attachment: Attachment,
    ) {
        super();
        this.setMaxListeners(0);
        raw.serializeAttachment(attachment);
    }

    get readyState() {
        return this.closed ? HibernatingSocket.CLOSED : this.raw.readyState;
    }

    send(data: string | Uint8Array, callback?: (error?: Error) => void) {
        if (this.readyState !== HibernatingSocket.OPEN) return callback?.(new Error("socket is not open"));
        try {
            this.raw.send(data);
        } catch (error) {
            return callback?.(error as Error);
        }
        this.persist();
        callback?.();
    }

    persist() {
        if (this.persistQueued) return;
        this.persistQueued = true;
        queueMicrotask(() => {
            this.persistQueued = false;
            if (this.closed) return;
            const fields = this as unknown as SocketFields;
            this.attachment = {
                ...this.attachment,
                sequence: fields.sequence ?? this.attachment.sequence,
                user_id: fields.user_id,
                session_id: fields.session_id,
                encoding: fields.encoding ?? this.attachment.encoding,
                compress: fields.compress ?? this.attachment.compress,
                headerSent: fields.deflate?.headerSent ?? this.attachment.headerSent,
            };
            try {
                this.raw.serializeAttachment(this.attachment);
            } catch (error) {
                console.error("[Gateway] could not store the socket attachment", error);
            }
        });
    }

    close(code = 1000, reason?: string) {
        if (this.closed) return;
        try {
            this.raw.close(code, reason?.slice(0, 120));
        } catch (error) {
            console.error("[Gateway] close failed", error);
        }
        this.finish(code, reason ?? "");
    }

    terminate() {
        this.close(4000);
    }

    finish(code: number, reason: string) {
        if (this.closed) return;
        this.closed = true;
        queueMicrotask(() => this.emit("close", code, Buffer.from(reason)));
    }

    ping() {}
    pong() {}
}
