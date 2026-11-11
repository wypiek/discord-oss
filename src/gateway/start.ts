process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

import { GatewayServer } from "./Server";
import fs from "node:fs";
import cluster from "node:cluster";

let port = Number(process.env.PORT);
if (isNaN(port)) port = 3002;

const server = new GatewayServer({
    port,
});

if (fs.existsSync("/proc/self/comm")) fs.writeFileSync("/proc/self/comm", `spacebar-gw-${cluster.worker ? cluster.worker.id : port}`);
process.title = `sb-gw-${cluster.worker ? cluster.worker.id : port}`;

server.start().then(() => {});
