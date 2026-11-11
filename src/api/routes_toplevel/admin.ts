import fs from "node:fs/promises";
import path from "node:path";
import express, { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { PUBLIC_ASSETS_FOLDER, brandPage } from "@spacebar/util";
import { compressedStatic } from "../../util/util/CompressedStatic";

const router = Router({ mergeParams: true });
const PAGE_FOLDER = path.join(PUBLIC_ASSETS_FOLDER, "admin");

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const page = await fs.readFile(path.join(PAGE_FOLDER, "index.html"), "utf8");
        res.set("Cache-Control", "no-cache").type("html").send(brandPage(page));
    },
);

// the page's own scripts and styles, so it works outside the bundle too (where /assets isn't served)
router.use(
    compressedStatic(PAGE_FOLDER),
    express.static(PAGE_FOLDER, {
        index: false,
        setHeaders: (res) => res.set("Cache-Control", "no-cache"),
    }),
);

export default router;
