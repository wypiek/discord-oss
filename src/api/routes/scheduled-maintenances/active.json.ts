import { Router, Request, Response } from "express";
import { route } from "@spacebar/api/middlewares";
import { getStatusSummary } from "@spacebar/api/util";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: false, // not part of public openapi
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { page, scheduled_maintenances } = await getStatusSummary();
        res.json({
            page,
            scheduled_maintenances: scheduled_maintenances.filter((m) => m.status !== "scheduled"),
        });
    },
);

export default router;
