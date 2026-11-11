import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Request, Response } from "express";
import { Config, isPrivateAddress } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";

const active = new Map<string, number>();
let total = 0;
export async function withApplicationOutbound<T>(applicationId: string, operation: () => Promise<T>): Promise<T> {
    if (!Config.get().externalRequests.thirdParty) throw new HTTPError("External application requests are disabled", 503);
    if (total >= 16 || (active.get(applicationId) ?? 0) >= 4) throw new HTTPError("Application outbound requests are busy", 503);
    total++;
    active.set(applicationId, (active.get(applicationId) ?? 0) + 1);
    try {
        return await operation();
    } finally {
        total--;
        const remaining = (active.get(applicationId) ?? 1) - 1;
        if (remaining) active.set(applicationId, remaining);
        else active.delete(applicationId);
    }
}
const requestHeaders = ["accept", "accept-language", "content-type", "cache-control", "range", "if-none-match", "if-modified-since", "if-range"];
const responseHeaders = ["content-type", "cache-control", "etag", "last-modified", "expires", "content-range", "accept-ranges", "location", "vary", "content-disposition"];
const bounded = (limit: number) => {
    let bytes = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(bytes > limit ? new HTTPError("Application proxy byte limit exceeded", 413) : null, chunk);
        },
    });
};

export async function proxyApplicationRequest(applicationId: string, url: string, req: Request, res: Response) {
    return withApplicationOutbound(applicationId, async () => {
        const target = new URL(url);
        if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new HTTPError("Invalid activity target", 502);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const abort = () => controller.abort();
        const close = () => {
            if (!res.writableEnded) abort();
        };
        req.once("aborted", abort);
        res.once("close", close);
        let cancelDns = () => {};
        try {
            const host = target.hostname.replace(/^\[|\]$/g, "");
            const addresses = isIP(host)
                ? [{ address: host, family: isIP(host) }]
                : await Promise.race([
                      lookup(host, { all: true, verbatim: true }),
                      new Promise<never>((_, reject) => {
                          cancelDns = () => reject(new HTTPError("Activity proxy timed out", 504));
                          controller.signal.addEventListener("abort", cancelDns, { once: true });
                      }),
                  ]);
            controller.signal.throwIfAborted();
            if (!addresses.length || (!Config.get().security.allowPrivateNetworkRequests && addresses.some(({ address }) => isPrivateAddress(address))))
                throw new HTTPError("Activity target is not public", 502);
            const address = addresses[0];
            const headers: Record<string, string | string[]> = { "accept-encoding": "identity" };
            for (const name of requestHeaders) if (req.headers[name]) headers[name] = req.headers[name]!;
            const length = req.headers["content-length"];
            if (length && (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > 8 * 1024 * 1024))
                throw new HTTPError("Activity request exceeds byte limit", 413);
            await new Promise<void>((resolve, reject) => {
                const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(
                    target,
                    {
                        method: req.method,
                        headers,
                        agent: false,
                        signal: controller.signal,
                        family: address.family,
                        lookup: (_hostname, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
                    },
                    (response) => {
                        try {
                            const size = response.headers["content-length"];
                            if (size && (!/^\d+$/.test(size) || Number(size) > 32 * 1024 * 1024)) throw new HTTPError("Activity response exceeds byte limit", 502);
                            if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")
                                throw new HTTPError("Compressed activity response refused", 502);
                            res.status(response.statusCode ?? 502);
                            for (const name of responseHeaders) if (response.headers[name] !== undefined) res.setHeader(name, response.headers[name]!);
                            pipeline(response, bounded(32 * 1024 * 1024), res, {
                                signal: controller.signal,
                            }).then(resolve, reject);
                        } catch (error) {
                            response.destroy();
                            upstream.destroy();
                            reject(error);
                        }
                    },
                );
                upstream.on("error", reject);
                if (["GET", "HEAD"].includes(req.method)) upstream.end();
                else pipeline(req, bounded(8 * 1024 * 1024), upstream, { signal: controller.signal }).catch(reject);
            });
        } finally {
            controller.abort();
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", cancelDns);
            req.removeListener("aborted", abort);
            res.removeListener("close", close);
        }
    });
}
