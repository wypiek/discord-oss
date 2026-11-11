import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { setCacheControlNotFound } from "../util";

const router = Router({ mergeParams: true });

const FILES: Record<string, { type: string; fallback: string }> = {
    "current_revision.txt": { type: "text/plain", fallback: "0" },
    "updated_hashes.json": { type: "application/json", fallback: "[]" },
    "hashes.json": { type: "application/json", fallback: "[]" },
};
const TTL = 3_600_000;
const cache = new Map<string, { body: Buffer; expires: number }>();

router.get("/:file", async (req: Request, res: Response) => {
    const file = req.params.file as string;
    const known = FILES[file];
    if (!known) return setCacheControlNotFound(req, res);
    let entry = cache.get(file);
    if (Config.get().externalRequests.discordBadDomains && (!entry || entry.expires < Date.now())) {
        const upstream = await fetch(`https://cdn.discordapp.com/bad-domains/${file}`, {
            signal: AbortSignal.timeout(10000),
            redirect: "error",
        }).catch(() => undefined);
        if (upstream?.ok) cache.set(file, (entry = { body: Buffer.from(await upstream.arrayBuffer()), expires: Date.now() + TTL }));
    }
    res.set("Content-Type", known.type);
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(entry?.body ?? known.fallback);
});

export default router;
