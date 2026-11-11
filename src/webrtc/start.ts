process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

import fs from "node:fs";
import cluster from "node:cluster";
import { WebrtcServer } from "./Server";

const port = Number(process.env.PORT) || 3004;

const server = new WebrtcServer({
    port,
});

if (fs.existsSync("/proc/self/comm")) fs.writeFileSync("/proc/self/comm", `spacebar-wrtc-${cluster.worker ? cluster.worker.id : port}`);
process.title = `sb-wrtc-${cluster.worker ? cluster.worker.id : port}`;

server.start().catch((e) => console.error("Failed to start WebRTC server:", e));
