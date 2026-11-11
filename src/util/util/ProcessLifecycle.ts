import { AsyncLocalStorage } from "node:async_hooks";
import EventEmitter from "node:events";
import { DgramSocket } from "node-unix-socket";

interface ProcessLifecycleEvents {
    starting: unknown[];
    running: unknown[];
    stopping: unknown[];
    draining: unknown[];
    stopped: unknown[];
    shutdownRequested: unknown[];
}

export class ProcessLifecycle {
    static state: keyof ProcessLifecycleEvents = "starting";
    static shutdownRequested = false;
    private static dispatchingShutdown = false;
    private static finalizeRequested = false;
    private static finalizing?: Promise<void>;
    private static readonly finalizer = new AsyncLocalStorage<boolean>();
    static eventEmitter: EventEmitter<ProcessLifecycleEvents> = new EventEmitter();

    static requestShutdown() {
        if (this.shutdownRequested) return;
        this.shutdownRequested = true;
        this.eventEmitter.emit("shutdownRequested");
    }

    // to be ran after startup is finished
    static async Ready() {
        if (this.shutdownRequested) return;
        await this.emitAsync((this.state = "running"));
        if (this.shutdownRequested) return;
        await SystemdLifecycle.sendReady();
    }

    static async Shutdown() {
        this.requestShutdown();
        if (this.state === "stopping" || this.state === "draining" || this.state === "stopped") return;
        this.state = "stopping";
        const deadline = setTimeout(() => {
            console.error("[Shutdown] Process did not exit within 30 seconds; forcing exit.");
            process.exit(1);
        }, 30_000);
        deadline.unref();
        this.dispatchingShutdown = true;
        try {
            await SystemdLifecycle.sendStopping();
            await this.emitAsync("stopping");
        } finally {
            this.dispatchingShutdown = false;
            if (this.finalizeRequested) await this.Finalize();
        }
    }

    static Finalize(): Promise<void> {
        if (this.finalizer.getStore()) return Promise.resolve();
        if (this.finalizing) return this.finalizing;
        if (this.state === "stopped") return Promise.resolve();
        if (this.dispatchingShutdown) {
            this.finalizeRequested = true;
            return Promise.resolve();
        }
        this.state = "draining";
        this.finalizing = Promise.resolve().then(() =>
            this.finalizer.run(true, async () => {
                await this.emitAsync("draining");
                this.state = "stopped";
                await this.emitAsync("stopped");
            }),
        );
        return this.finalizing;
    }

    // emit, except it awaits promises
    private static async emitAsync(eventName: keyof ProcessLifecycleEvents) {
        for (const evt of this.eventEmitter.listeners(eventName)) {
            // noinspection JSVoidFunctionReturnValueUsed - we want to handle async functions blocking aswell
            const res = evt() as void | Promise<void>;
            if (res) await res;
        }
    }
}

const whyIsNodeRunning = process.env.TRACE_ACTIVE_HANDLES ? import("why-is-node-running") : undefined;

process.on("SIGUSR1", async () => {
    console.log("Handling SIGUSR1:");
    if (whyIsNodeRunning) (await whyIsNodeRunning).default();
    else console.log("Set TRACE_ACTIVE_HANDLES=1 at startup to list active handles.");
    console.log("\nProcess state:", ProcessLifecycle.state);
});

export class SystemdLifecycle {
    private static writeData(data: string): Promise<void> {
        const socketPath = process.env.NOTIFY_SOCKET;
        if (!socketPath) return Promise.resolve();

        const buf = Buffer.from(data);
        console.log("Systemd notify socket path:", socketPath, "-", buf.length, "bytes");

        return new Promise((res, rej) => {
            new DgramSocket().sendTo(buf, 0, buf.length, socketPath, (err) => {
                if (err) rej(err);
                res();
            });
        });
    }
    static async sendReady() {
        await this.writeData("READY=1");
    }

    static async sendStopping() {
        await this.writeData("STOPPING=1");
    }

    static async setStatus(status: string) {
        await this.writeData("STATUS=" + status);
    }

    // TODO: do we want to support the watchdog?
}
