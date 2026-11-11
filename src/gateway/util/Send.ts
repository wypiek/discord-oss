import { Payload, WebSocket } from "@spacebar/gateway";
import fs from "node:fs/promises";
import path from "node:path";

import { JSONStringify } from "@spacebar/util";
import { boundedDispatchPush, bufferForResume, notePayloadSize, rememberDispatch, resolveSocket } from "./SessionResume";
import { filterBotDispatch } from "./GatewayIntents";
import { packEtf } from "./Etf";

const serializedData = new WeakMap<object, string>();

export function serializePayload(data: Payload) {
    if (data.op !== 0 || typeof data.t !== "string" || typeof data.s !== "number" || typeof data.d !== "object" || data.d === null) return JSONStringify(data);
    let d = serializedData.get(data.d);
    if (d === undefined) serializedData.set(data.d, (d = JSONStringify(data.d)));
    return `{"op":0,"t":${JSON.stringify(data.t)},"d":${d},"s":${data.s}}`;
}

export async function Send(target: WebSocket, data: Payload, guildId?: string) {
    const socket = resolveSocket(target);
    const filtered = filterBotDispatch(socket, data, guildId);
    if (!filtered) return;
    data = filtered;
    if (socket.pendingDispatches && data.op === 0 && data.t !== "READY" && data.t !== "READY_SUPPLEMENTAL" && data.t !== "GUILD_CREATE") {
        if (!boundedDispatchPush(socket.pendingDispatches, data, 1000, 8 * 1024 * 1024)) {
            socket.pendingDispatches = undefined;
            socket.close(4008, "Pending dispatch limit exceeded");
        }
        return;
    }
    const json = serializePayload(data);
    notePayloadSize(data, Buffer.byteLength(json));
    if (socket.readyState !== 1 && data.op === 0 && bufferForResume(socket, data)) return;
    rememberDispatch(socket, data);
    if (process.env.WS_VERBOSE) console.log(`[Websocket] Outgoing message: ${JSON.stringify(data)}`);

    if (process.env.WS_DUMP) {
        const id = socket.session_id || "unknown";

        await fs.mkdir(path.join("dump", id), {
            recursive: true,
        });
        await fs.writeFile(path.join("dump", id, `${Date.now()}.out.json`), JSON.stringify(data, null, 2));
    }

    if (socket.encoding !== "json" && socket.encoding !== "etf") return;
    let buffer: Buffer | string = json;
    if (socket.encoding === "etf") buffer = packEtf(JSON.parse(buffer));

    if (socket.compress === "zlib-stream") buffer = socket.deflate!.process(buffer) as Buffer;
    else if (socket.compress === "zstd-stream") buffer = socket.zstdEncoder!.process(buffer);

    return new Promise((res) => {
        if (socket.readyState === 1 && socket.bufferedAmount + (typeof buffer === "string" ? Buffer.byteLength(buffer) : buffer.byteLength) > 32 * 1024 * 1024) {
            socket.close(4008, "Outgoing dispatch limit exceeded");
            res(null);
        } else if (socket.readyState === 1) socket.send(buffer, () => res(null));
        else {
            socket.close();
            res(null);
        }
    });
}
