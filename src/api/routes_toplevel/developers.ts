import fs from "node:fs/promises";
import path from "node:path";
import express, { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config, PUBLIC_ASSETS_FOLDER } from "@spacebar/util";
import { compressedStatic } from "../../util/util/CompressedStatic";

const router = Router({ mergeParams: true });
const PAGE_FOLDER = path.join(PUBLIC_ASSETS_FOLDER, "developers");

router.use(
    compressedStatic(PAGE_FOLDER),
    express.static(PAGE_FOLDER, {
        index: false,
        redirect: false,
        setHeaders: (res) => res.set("Cache-Control", "no-cache"),
    }),
);

router.get(
    "/docs{/*splat}",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => res.redirect(302, "https://docs.discord.food/"),
);

router.get(
    "/{*splat}",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { client, cdn, general } = Config.get();
        const config = JSON.stringify({
            instanceName: client.instanceName,
            icon: general.image || "/static/logo.png",
            cdn: cdn.endpointPublic?.replace(/\/+$/, "") ?? "",
            activityHost: (client.activityApplicationHost ?? "").replace(/^(https?:)?\/\//, "").replace(/\/.*$/, ""),
        }).replace(/</g, "\\u003c");
        const page = (await fs.readFile(path.join(PAGE_FOLDER, "index.html"), "utf8"))
            .replace("{{CONFIG}}", config)
            .replace("{{TITLE}}", `${client.instanceName.replace(/[<>&"]/g, "")} Developer Portal`);
        res.set("Cache-Control", "no-cache");
        res.type("html").send(page);
    },
);

export default router;
