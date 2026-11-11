import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { getStatusMetrics, isMetricPeriod } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        query: {
            period: { type: "string", required: false, description: "day, week or month. Defaults to day." },
        },
        description: "Median API response time for the status page's system metrics chart",
    }),
    async (req: Request, res: Response) => {
        const period = req.query.period ?? "day";
        if (!isMetricPeriod(period)) throw new HTTPError("period must be day, week or month", 400);
        res.set("Cache-Control", "public, max-age=60");
        res.json(await getStatusMetrics(period));
    },
);

export default router;
