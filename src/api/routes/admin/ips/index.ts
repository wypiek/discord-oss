import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { addressQuery, listIps, listOffset } from "@spacebar/api/util";
import { paginationQuery, scalarQuery } from "../users/index";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        right: "VIEW_USERS",
        spacebarOnly: true,
        description:
            "Hashed IP addresses that accounts registered on or signed in from, with how many accounts used each, most accounts first. Each row gives the full hash as `ip` and its first 10 characters as `fingerprint`. Session addresses disappear when the session ends; registration addresses stay.",
        query: {
            q: { type: "string", required: false, description: "A full IPv4 or IPv6 address, or an address hash, to find exactly" },
            limit: { type: "number", required: false },
            offset: { type: "number", required: false },
        },
    }),
    async (req: Request, res: Response) => {
        const q = scalarQuery(req.query.q, "q", "").trim();
        const hash = q ? addressQuery(q) : null;
        if (q && !hash) throw new HTTPError("q must be a full IPv4 or IPv6 address or an address hash", 400);
        const limit = Math.min(Math.max(paginationQuery(req.query.limit, "limit", 50), 1), 100);
        const offset = listOffset(req.query.offset);
        res.set("Cache-Control", "no-store");
        res.json(await listIps({ ips: hash ? [hash] : undefined, limit, offset }));
    },
);

export default router;
