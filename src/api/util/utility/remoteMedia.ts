import { lookup } from "node:dns/promises";
import { request as requestHttp, IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { Blob } from "node:buffer";
import { fetchPublicUrl, isPrivateAddress } from "@spacebar/util/util/networking/PublicNetwork";
import { outboundProxy } from "@spacebar/util/util/networking/SocksTransport";

const resolveMediaHost = async (hostname: string, signal: AbortSignal) => {
    let onAbort = () => {};
    try {
        return await Promise.race([
            lookup(hostname, { all: true, verbatim: true }),
            new Promise<never>((_, reject) => {
                onAbort = () => reject(new Error("Media download timed out"));
                signal.addEventListener("abort", onAbort, { once: true });
            }),
        ]);
    } finally {
        signal.removeEventListener("abort", onAbort);
    }
};

const publicMediaAddress = async (url: URL, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Media URL must use public HTTP or HTTPS without credentials");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolveMediaHost(hostname, signal);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Media URL must resolve only to public addresses");
    return addresses[0];
};

const readMediaResponse = async (response: IncomingMessage, maxBytes: number) => {
    const encoding = response.headers["content-encoding"];
    if (encoding && encoding !== "identity") throw new Error("Compressed remote media is not supported");
    const declaredSize = response.headers["content-length"];
    if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) throw new Error("Remote media exceeds the download size limit");
    const chunks: Buffer<ArrayBuffer>[] = [];
    let bytes = 0;
    for await (const part of response) {
        const chunk = Buffer.from(part);
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error("Remote media exceeds the download size limit");
        chunks.push(chunk);
    }
    if (!response.complete) throw new Error("Remote media response was interrupted");
    return new Blob(chunks, { type: response.headers["content-type"] || "application/octet-stream" });
};

export const downloadRemoteMedia = async (source: string | URL, maxBytes: number, timeoutMs = 15000): Promise<Blob> => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid media download limits");
    if (outboundProxy() !== "direct") {
        const response = await fetchPublicUrl(new URL(source).href, { headers: { accept: "*/*" } }, 3, {
            maxBytes: Math.min(maxBytes, 64 * 1024 * 1024),
            timeoutMs: Math.min(timeoutMs, 30000),
        });
        if (!response.ok) throw new Error(`Remote media answered ${response.status}`);
        return response.blob();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Media download timed out")), timeoutMs);
    const download = async (url: URL, redirects: number): Promise<Blob> => {
        const address = await publicMediaAddress(url, controller.signal);
        return new Promise<Blob>((resolve, reject) => {
            const request = (url.protocol === "https:" ? requestHttps : requestHttp)(
                url,
                {
                    agent: false,
                    family: address.family,
                    signal: controller.signal,
                    headers: { "accept-encoding": "identity" },
                    lookup: (_hostname, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
                },
                (response) => {
                    const status = response.statusCode || 0;
                    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
                        response.destroy();
                        if (redirects === 0) return reject(new Error("Too many remote media redirects"));
                        let destination: URL;
                        try {
                            destination = new URL(response.headers.location, url);
                        } catch {
                            return reject(new Error("Invalid remote media redirect URL"));
                        }
                        download(destination, redirects - 1).then(resolve, reject);
                        return;
                    }
                    if (status < 200 || status >= 300) {
                        response.destroy();
                        return reject(new Error("Remote media did not return a successful response"));
                    }
                    readMediaResponse(response, maxBytes).then(resolve, (error) => {
                        response.destroy();
                        reject(error);
                    });
                },
            );
            request.on("error", reject);
            request.end();
        });
    };
    try {
        return await download(new URL(source), 3);
    } finally {
        clearTimeout(timer);
    }
};
