import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { Config } from "@spacebar/util";

const BUNDLE_PATH = path.join(__dirname, "..", "..", "assets", "public", "mobile", "meowcord.js");
const PLACEHOLDER = '"__MEOWCORD_ENDPOINTS__"';

export type MobileEndpoints = { api: string; gateway: string; cdn: string; media: string };

const httpOrigin = (value: unknown) => {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
        return null;
    }
};

const absolute = (value: string | null | undefined, protocols: string[]) => {
    if (!value) return null;
    try {
        return protocols.includes(new URL(value).protocol) ? value.replace(/\/+$/, "") : null;
    } catch {
        return null;
    }
};

export const mobileEndpoints = (requestOrigin: string, instance?: unknown): MobileEndpoints => {
    const override = httpOrigin(instance);
    const origin = override ?? requestOrigin;
    const fallback = { api: `${origin}/api/v9`, gateway: origin.replace(/^http/, "ws"), cdn: origin, media: origin };
    if (override) return fallback;
    const { api, gateway, cdn } = Config.get();
    const cdnEndpoint = absolute(cdn.endpointPublic, ["http:", "https:"]) ?? fallback.cdn;
    return {
        api: absolute(api.endpointPublic, ["http:", "https:"]) ?? fallback.api,
        gateway: absolute(gateway.endpointPublic, ["ws:", "wss:"]) ?? fallback.gateway,
        cdn: cdnEndpoint,
        media: cdnEndpoint,
    };
};

export const sendMobileBundle = (req: Request, res: Response) => {
    if (!fs.existsSync(BUNDLE_PATH)) return res.status(404).type("txt").send("The mobile bundle is not built. Run `bun run build:mobile`.");
    const endpoints = {
        ...mobileEndpoints(`${req.protocol}://${req.get("host")}`, req.query.instance),
        e2eeTrustServer: Config.get().limits.e2ee.trustServerByDefault !== false,
        ...(req.query.debug === "1" && { debug: true }),
    };
    const code = fs.readFileSync(BUNDLE_PATH, "utf8").replace(PLACEHOLDER, () => JSON.stringify(JSON.stringify(endpoints)));
    res.set("Cache-Control", "no-cache").type("js").send(code);
};
