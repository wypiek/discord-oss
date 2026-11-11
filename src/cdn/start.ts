process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

import fs from "node:fs";
import cluster from "node:cluster";
import { CDNServer } from "./Server";

const server = new CDNServer({ port: Number(process.env.PORT) || 3003 });
server
    .start()
    .then(() => {
        if (fs.existsSync("/proc/self/comm")) fs.writeFileSync("/proc/self/comm", `spacebar-cdn-${cluster.worker ? cluster.worker.id : server.options.port}`);
        process.title = `sb-cdn-${cluster.worker ? cluster.worker.id : server.options.port}`;

        console.log("[Server] started on :" + server.options.port);
    })
    .catch((e) => console.error("[Server] Error starting: ", e));

module.exports = server;
