import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { getDatabase } from "@spacebar/database";
import { databaseReady } from "../util/utility/readiness";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        res.setHeader("Cache-Control", "no-store");
        return res.sendStatus((await databaseReady(getDatabase())) ? 200 : 503);
    },
);

export default router;
