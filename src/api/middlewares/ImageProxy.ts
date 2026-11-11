import { Config, corsProxyUrl } from "@spacebar/util";
import { fetchPublicUrl } from "@spacebar/util/util/networking/PublicNetwork";
import { Request, Response } from "express";
import crypto from "node:crypto";

const supported = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);
let active = 0;

export async function ImageProxy(req: Request, res: Response) {
    const path = req.originalUrl.split("/").slice(2);
    const hash = crypto.createHmac("sha1", Config.get().security.requestSignature).update(path.slice(1).join("/")).digest("base64").replace(/\+/g, "-").replace(/\//g, "_");
    const supplied = path[0] ?? "";
    if (hash.length !== supplied.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(supplied))) return res.status(403).send("Invalid signature");
    if (active >= 4) return res.status(503).send("Media proxy is busy");
    active++;
    try {
        const target = corsProxyUrl(new URL(`https://${path.slice(2).join("/")}`));
        const request = await fetchPublicUrl(
            target,
            {
                headers: { "User-Agent": "SpacebarImageProxy/1.0.0" },
                redirect: "error",
            },
            0,
            { maxBytes: 10 * 1024 * 1024, timeoutMs: 5000, allowExternal: true },
        );
        if (!request.ok) return res.status(request.status).send("Media proxy request failed");
        const contentType = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
        if (!supported.has(contentType)) return res.status(415).send("Unsupported media type");
        const [width, height] = path[1].split("x").map(Number);
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096)
            return res.status(400).send("Invalid image dimensions");
        const sharp = await import("sharp").catch(() => null);
        if (!sharp) return res.status(415).send("Image resizing is unavailable");
        const result = await sharp
            .default(Buffer.from(await request.arrayBuffer()), {
                limitInputPixels: 16 * 1024 * 1024,
                animated: false,
            })
            .resize({ width, height, fit: "inside", withoutEnlargement: true })
            .timeout({ seconds: 5 })
            .toBuffer();
        res.header("Content-Type", contentType);
        res.setHeader("Cache-Control", `public, max-age=${Config.get().cdn.proxyCacheHeaderSeconds}`);
        return res.send(result);
    } catch {
        return res.status(502).send("Unable to proxy media");
    } finally {
        active--;
    }
}
