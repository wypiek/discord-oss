import { NextFunction, Request, Response } from "express";
import { EmbeddedActivity } from "@spacebar/database";
import { Config } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { proxyApplicationRequest } from "@spacebar/api/util/utility/applicationOutbound";
import { APPLICATION_EMBEDDED, BUILTIN_ACTIVITIES } from "./index";

const LOOKUP_TTL = 30_000;
const LOOKUP_LIMIT = 4096;
const LOOKUP_CONCURRENCY = 32;
const lookups = new Map<string, { activity: EmbeddedActivity | null; expires: number }>();
const pendingLookups = new Map<string, Promise<EmbeddedActivity | null>>();
let activeLookups = 0;

export const forgetActivityLookup = (applicationId: string) => {
    lookups.delete(applicationId);
    pendingLookups.delete(applicationId);
};

const lookup = async (applicationId: string) => {
    const cached = lookups.get(applicationId);
    if (cached && cached.expires > Date.now()) return cached.activity;
    lookups.delete(applicationId);
    const pending = pendingLookups.get(applicationId);
    if (pending) return pending;
    if (activeLookups >= LOOKUP_CONCURRENCY) throw new HTTPError("Activity lookups are busy", 503);
    activeLookups++;
    const operation = Promise.resolve()
        .then(() =>
            EmbeddedActivity.findOne({
                where: { application_id: applicationId },
                relations: { application: true },
            }),
        )
        .then((found) => {
            const activity = found && found.application.flags & APPLICATION_EMBEDDED ? found : null;
            if (pendingLookups.get(applicationId) === operation) {
                if (lookups.size >= LOOKUP_LIMIT) lookups.delete(lookups.keys().next().value!);
                lookups.set(applicationId, { activity, expires: Date.now() + LOOKUP_TTL });
            }
            return activity;
        })
        .finally(() => {
            activeLookups--;
            if (pendingLookups.get(applicationId) === operation) pendingLookups.delete(applicationId);
        });
    pendingLookups.set(applicationId, operation);
    return operation;
};

export const activityHostBase = () =>
    (Config.get().client.activityApplicationHost ?? "")
        .replace(/^(https?:)?\/\//, "")
        .replace(/[:/].*$/, "")
        .toLowerCase();

const matchesPrefix = (pathname: string, prefix: string) => {
    const base = prefix.replace(/\/+$/, "");
    return !base || pathname === base || pathname.startsWith(`${base}/`);
};

async function serve(applicationId: string, req: Request, res: Response) {
    const activity = await lookup(applicationId);
    if (!activity) return res.status(404).type("text/plain").send("Unknown activity");

    const [pathname, query] = req.url.split(/\?(.*)/s);
    const search = query ? `?${query}` : "";
    const inner = pathname === "/.proxy" ? "/" : pathname.startsWith("/.proxy/") ? pathname.slice("/.proxy".length) : pathname;
    const mapping = [...activity.url_mappings].sort((a, b) => b.prefix.length - a.prefix.length).find((m) => matchesPrefix(inner, m.prefix));
    if (!mapping) return res.status(404).type("text/plain").send("No URL mapping for this path");
    const rest = `/${inner.slice(mapping.prefix.replace(/\/+$/, "").length).replace(/^\/+/, "")}`;

    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    if (!mapping.target.startsWith("builtin://")) {
        const base = new URL(/^https?:\/\//.test(mapping.target) ? mapping.target : `https://${mapping.target}`);
        return proxyApplicationRequest(applicationId, `${base.origin}${base.pathname.replace(/\/+$/, "")}${rest}${search}`, req, res);
    }

    const builtin = BUILTIN_ACTIVITIES[mapping.target.slice("builtin://".length)];
    if (!builtin) return res.status(404).type("text/plain").send("Unknown activity");
    res.locals.applicationId = applicationId;
    req.url = `${rest}${search}`;
    builtin.router(req, res, () => {
        if (!res.headersSent) res.status(404).type("text/plain").send("Not found");
    });
}

export function ActivityHost(req: Request, res: Response, next: NextFunction) {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    const match = /^(\d{15,21})\.([a-z0-9.-]+)$/.exec(hostname);
    if (!match) return next();
    const base = activityHostBase();
    if (base && match[2] !== base) return next();
    serve(match[1], req, res).catch((error) => {
        const status = [413, 503, 504].includes(error?.code) ? error.code : 502;
        console.error(`[Activities] ${req.method} application ${match[1]} failed with ${status}`);
        if (!res.headersSent)
            res.status(status)
                .type("text/plain")
                .send(status === 503 ? "External activity requests are disabled or busy" : "Bad gateway");
        else res.end();
    });
}
