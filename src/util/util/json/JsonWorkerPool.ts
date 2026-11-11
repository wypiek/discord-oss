import { Worker } from "node:worker_threads";
import { join } from "node:path";
import os from "node:os";
import { EventWork } from "../ipc/EventWork";
import { ProcessLifecycle } from "../ProcessLifecycle";
import { maxJsonInputBytes } from "./JsonInput";
import { measureJsonValue } from "./JsonSize";

interface PendingRequest {
    bytes: number;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface WorkerState {
    worker: Worker;
    pending: Map<number, PendingRequest>;
    failed: boolean;
}

export class JsonWorkerPool {
    private static readonly maxPendingRequests = 1024;
    private static readonly maxPendingInputBytes = maxJsonInputBytes;
    private readonly workers = new Set<WorkerState>();
    private readonly terminating = new Set<Promise<unknown>>();
    private readonly work = new EventWork();
    private nextId = 0;
    private pendingRequests = 0;
    private pendingInputBytes = 0;
    private registered = false;
    private terminationFailed = false;
    private closing?: Promise<void>;

    request(type: "serialize", value: unknown): Promise<string | undefined>;
    request(type: "deserialize", value: string): Promise<unknown>;
    request(type: "serialize" | "deserialize", value: unknown): Promise<unknown> {
        if (this.closing || this.terminationFailed) return Promise.reject(new Error("JSON worker pool is closing"));
        let admitted = false;
        let result: Promise<unknown> | undefined;
        this.work.run(() => {
            admitted = true;
            result = this.dispatch(type, value);
            return result.then(
                () => {},
                () => {},
            );
        });
        return admitted ? result! : Promise.reject(new Error("JSON worker pool is closing"));
    }

    private limit(): number {
        const configured = process.env.JSON_WORKERS;
        if (configured !== undefined) {
            const count = Number(configured);
            if (!/^[1-9]\d*$/.test(configured) || !Number.isSafeInteger(count) || count > 128) throw new Error("JSON_WORKERS must be an integer between 1 and 128");
            return count;
        }
        return Math.max(1, Math.min(128, os.cpus().length));
    }

    private select(): WorkerState {
        const limit = this.limit();
        const selected = Array.from(this.workers).sort((first, second) => first.pending.size - second.pending.size)[0];
        if (selected && (!selected.pending.size || this.workers.size >= limit)) return selected;
        const worker = new Worker(join(__dirname, "jsonWorker.js"));
        const state: WorkerState = { worker, pending: new Map(), failed: false };
        worker.on("message", (message: { id?: number; result?: unknown; error?: string }) => {
            if (!message || typeof message.id !== "number" || !state.pending.has(message.id)) return;
            if (message.error) this.settle(state, message.id, new Error(message.error));
            else this.settle(state, message.id, undefined, message.result);
        });
        worker.on("error", () => this.fail(state, new Error("JSON worker failed")));
        worker.once("exit", () => this.fail(state, new Error("JSON worker exited")));
        worker.unref();
        this.workers.add(state);
        return state;
    }

    private dispatch(type: "serialize" | "deserialize", value: unknown): Promise<unknown> {
        try {
            if (this.pendingRequests >= JsonWorkerPool.maxPendingRequests)
                throw Object.assign(new Error("JSON worker queue capacity exceeded"), {
                    code: "JSON_QUEUE_FULL",
                });
            const snapshot = type === "serialize" ? structuredClone(value) : value;
            if (this.closing || this.terminationFailed) throw new Error("JSON worker pool is closing");
            if (this.pendingRequests >= JsonWorkerPool.maxPendingRequests)
                throw Object.assign(new Error("JSON worker queue capacity exceeded"), {
                    code: "JSON_QUEUE_FULL",
                });
            const bytes =
                type === "serialize"
                    ? measureJsonValue(snapshot, JsonWorkerPool.maxPendingInputBytes - this.pendingInputBytes)
                    : typeof value === "string"
                      ? Buffer.byteLength(value)
                      : 0;
            if (bytes > JsonWorkerPool.maxPendingInputBytes - this.pendingInputBytes)
                throw Object.assign(new Error("JSON worker input byte capacity exceeded"), {
                    code: "JSON_QUEUE_FULL",
                });
            const state = this.select();
            if (!this.registered) {
                this.registered = true;
                ProcessLifecycle.eventEmitter.on("stopped", () => this.close());
            }
            const id = ++this.nextId;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => this.fail(state, new Error("JSON worker timeout")), 60_000).unref();
                state.pending.set(id, { resolve, reject, timer, bytes });
                this.pendingRequests++;
                this.pendingInputBytes += bytes;
                state.worker.ref();
                try {
                    state.worker.postMessage(type === "serialize" ? { id, type, value: snapshot } : { id, type, json: value });
                } catch (error) {
                    this.settle(state, id, error instanceof Error ? error : new Error("JSON request could not be sent"));
                }
            });
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error("JSON worker could not start"));
        }
    }

    private settle(state: WorkerState, id: number, error?: Error, result?: unknown) {
        const pending = state.pending.get(id);
        if (!pending) return;
        state.pending.delete(id);
        this.pendingRequests--;
        this.pendingInputBytes -= pending.bytes;
        clearTimeout(pending.timer);
        if (!state.pending.size) state.worker.unref();
        if (error) pending.reject(error);
        else pending.resolve(result);
    }

    private fail(state: WorkerState, error: Error) {
        if (state.failed) return;
        state.failed = true;
        this.workers.delete(state);
        for (const id of state.pending.keys()) this.settle(state, id, error);
        this.terminate(state);
    }

    private terminate(state: WorkerState) {
        const termination = Promise.resolve()
            .then(() => state.worker.terminate())
            .then(
                () => {},
                () => {
                    this.terminationFailed = true;
                },
            )
            .finally(() => this.terminating.delete(termination));
        this.terminating.add(termination);
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closing = Promise.resolve().then(async () => {
            await this.work.close();
            for (const state of this.workers) {
                state.failed = true;
                this.terminate(state);
            }
            this.workers.clear();
            while (this.terminating.size) await Promise.all(this.terminating);
            if (this.terminationFailed) throw new Error("JSON worker termination failed");
        });
        return this.closing;
    }
}
