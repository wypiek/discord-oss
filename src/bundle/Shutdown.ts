import cluster from "node:cluster";
import { ProcessLifecycle } from "@spacebar/util/util/ProcessLifecycle";

export const installShutdownSignals = (startup: () => Promise<void>) => {
    let requested = false;
    const shutdown = () => {
        if (requested) return;
        requested = true;
        ProcessLifecycle.requestShutdown();
        const deadline = setTimeout(() => {
            console.error("[Shutdown] Startup or cleanup did not finish within 30 seconds; forcing exit.");
            process.exit(1);
        }, 30_000).unref();
        process.once("exit", () => clearTimeout(deadline));
        Promise.resolve()
            .then(startup)
            .catch((error) => console.error("[Shutdown] Startup failed before shutdown", error))
            .then(async () => {
                await ProcessLifecycle.Shutdown();
                await ProcessLifecycle.Finalize();
                if (cluster.isWorker && process.connected) process.disconnect?.();
            })
            .catch((error) => {
                console.error("[Shutdown] Signal cleanup failed", error);
                process.exitCode = 1;
            });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
};

export const installClusterShutdownSignals = () => {
    let stopping = false;
    const shutdown = () => {
        if (stopping) return;
        stopping = true;
        const deadline = setTimeout(() => {
            console.error("[Shutdown] Workers did not exit within 30 seconds; forcing exit.");
            process.exit(1);
        }, 30_000).unref();
        process.once("exit", () => clearTimeout(deadline));
        for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill("SIGTERM");
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    return () => stopping;
};
