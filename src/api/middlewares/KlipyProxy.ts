import { Config, fetchPublicUrl } from "@spacebar/util";
import { Request, Response } from "express";
import { finished } from "node:stream/promises";

const HOSTS = ["static.klipy.com", "static2.klipy.com"];
const PASSTHROUGH_HEADERS = ["content-type", "content-range", "accept-ranges", "last-modified", "etag"];
let active = 0;

export async function KlipyProxy(req: Request, res: Response) {
    const path = req.originalUrl.split("?")[0].replace(/^\/klipy\//, "");
    if (!/^[\w\-./%]+$/.test(path) || path.includes("..") || path.length > 2048) return res.status(400).send("Invalid path");
    if (!Config.get().externalRequests.thirdParty) return res.status(503).send("External media requests are disabled");
    if (active >= 4) return res.status(503).set("Retry-After", "1").send("Media capacity is busy");
    const range = req.headers.range;
    if (range && !/^bytes=\d*-\d*$/.test(range)) return res.status(400).send("Invalid range");
    active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, 30_000);
    timeout.unref();
    res.once("close", abort);
    try {
        for (const host of HOSTS) {
            const upstream = await fetchPublicUrl(
                `https://${host}/${path}`,
                {
                    method: req.method === "HEAD" ? "HEAD" : "GET",
                    headers: {
                        "user-agent": Config.get().embeds.defaultUserAgent ?? "Mozilla/5.0",
                        ...(range ? { range } : {}),
                    },
                    signal: controller.signal,
                },
                0,
                {
                    maxBytes: 32 * 1024 * 1024,
                    timeoutMs: 15_000,
                    allowExternal: Config.get().externalRequests.thirdParty,
                },
            ).catch(() => null);
            if (!upstream || upstream.status === 404) continue;
            if (!upstream.ok) {
                res.status(upstream.status).send("Media origin rejected request");
                await finished(res);
                return;
            }
            const mime = upstream.headers.get("content-type") ?? "";
            if (!/^(image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm))(?:;|$)/i.test(mime)) {
                res.status(415).send("Unsupported media type");
                await finished(res);
                return;
            }
            res.status(upstream.status);
            for (const header of PASSTHROUGH_HEADERS) {
                const value = upstream.headers.get(header);
                if (value) res.setHeader(header, value);
            }
            res.setHeader("cache-control", `public, max-age=${Config.get().cdn.proxyCacheHeaderSeconds}`);
            res.setHeader("access-control-allow-origin", "*");
            res.setHeader("cross-origin-resource-policy", "cross-origin");
            res.send(req.method === "HEAD" ? undefined : Buffer.from(await upstream.arrayBuffer()));
            await finished(res);
            return;
        }
        res.status(404).send("Not found");
        await finished(res);
    } finally {
        clearTimeout(timeout);
        res.removeListener("close", abort);
        controller.abort();
        active--;
    }
}
