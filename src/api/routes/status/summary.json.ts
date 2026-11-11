import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { getStatusSummary } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        description: "Public status page summary (statuspage.io compatible): overall status, components, open incidents, maintenance and recent history",
    }),
    async (req: Request, res: Response) => {
        res.set("Cache-Control", "public, max-age=30");
        res.json(await getStatusSummary());
    },
);

export default router;
