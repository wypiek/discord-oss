import path from "node:path";
import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { ASSETS_FOLDER } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        res.set("Cache-Control", "public, max-age=21600");
        return res.sendFile(path.join(ASSETS_FOLDER, "schemas.json"), { dotfiles: "allow" });
    },
);

export default router;
