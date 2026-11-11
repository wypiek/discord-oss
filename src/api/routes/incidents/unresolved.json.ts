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
        const { page, incidents } = await getStatusSummary();
        res.json({ page, incidents });
    },
);

export default router;
