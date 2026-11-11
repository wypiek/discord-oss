import fs from "node:fs/promises";
import path from "node:path";
import express, { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { statusAtomFeed } from "@spacebar/api/util";
import { PUBLIC_ASSETS_FOLDER, brandPage } from "@spacebar/util";

const router = Router({ mergeParams: true });
const PAGE_FOLDER = path.join(PUBLIC_ASSETS_FOLDER, "status");

const sendPage = async (req: Request, res: Response) => {
    const html = await fs.readFile(path.join(PAGE_FOLDER, "index.html"), "utf8");
    res.set("Cache-Control", "no-cache").type("html").send(brandPage(html));
};

for (const at of ["/", "/history", "/uptime"]) router.get(at, route({ spacebarOnly: true, authentication: "never" }), sendPage);

router.get("/history.atom", route({ spacebarOnly: true, authentication: "never" }), async (req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=60")
        .type("application/atom+xml")
        .send(await statusAtomFeed(`${req.protocol}://${req.get("host")}`));
});

router.use(
    express.static(PAGE_FOLDER, {
        index: false,
        setHeaders: (res) => res.set("Cache-Control", "no-cache"),
    }),
);

export default router;
