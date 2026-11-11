import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { getDatabase } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        deprecated: true,
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        if (!getDatabase()) return res.sendStatus(503);

        return res.sendStatus(200);
    },
);

export default router;
