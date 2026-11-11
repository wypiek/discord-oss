import { emitEvent } from "@spacebar/util";

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

process.env.DB_LOGGING = "true";

import fs from "node:fs/promises";
import { UnixSocketWriter } from "@spacebar/util/util/ipc/writer/UnixSocketWriter";
import { Event } from "@spacebar/util/interfaces/Event";
import { sleep } from "@spacebar/extensions";

function getArgvOrFail(idx: number, message: string) {
    if (process.argv.length <= idx) throw message + "\n";
    return process.argv[idx];
}

async function main() {
    const sockDir = getArgvOrFail(2, "Usage: bun dist/send-ipc-message.js <socket dir>");
    if (!(await fs.readdir(sockDir))) throw `Socket directory "${sockDir}" is not a valid directory`;

    const unixWriter = new UnixSocketWriter(sockDir);
    await unixWriter.init();

    const payloadJson = await fs.readFile("/dev/stdin", "utf-8");
    const payload = JSON.parse(payloadJson) as Event;

    payload.origin ??= "send-ipc-message";
    payload.created_at ??= new Date();
    payload.transaction_id ??= process.pid.toString();

    const id = (payload.guild_id || payload.channel_id || payload.user_id || payload.session_id) as string;
    if (!id) return console.error("event doesn't contain any id", payload);
    // (payload as unknown).id = id;

    await unixWriter.emit(payload);
    console.log("Emitted...");
    await sleep(1000);
    await unixWriter.close();
    console.log("Closed...");
}

main().then(() => console.log("meow"));
