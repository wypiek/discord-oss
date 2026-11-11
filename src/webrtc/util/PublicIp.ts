import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export const resolvePublicIp = async (host: string, timeoutMs = 15000) => {
    if (isIP(host)) return host;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            return (await lookup(host, { family: 4 })).address;
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await sleep(250);
        }
    }
};
