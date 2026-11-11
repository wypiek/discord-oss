process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

import cluster from "node:cluster";
import os from "node:os";
import fs from "node:fs";
import { SpacebarServer } from "./Server";

let cores = 1;
try {
    cores = Number(process.env.THREADS) || os.cpus().length;
} catch {
    console.log("[API] Failed to get thread count! Using 1...");
}

if (cluster.isPrimary && process.env.NODE_ENV == "production") {
    console.log(`Primary PID: ${process.pid}`);

    // Fork workers.
    for (let i = 0; i < cores; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker) => {
        console.log(`Worker ${worker.process.pid} died, restarting worker`);
        cluster.fork();
    });
} else {
    const port = Number(process.env.PORT) || 3001;

    if (fs.existsSync("/proc/self/comm")) fs.writeFileSync("/proc/self/comm", `spacebar-api-${cluster.worker ? cluster.worker.id : port}`);
    process.title = `sb-api-${cluster.worker ? cluster.worker.id : port}`;

    const server = new SpacebarServer({ port });
    server.start().catch(console.error);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    global.server = server;
}
