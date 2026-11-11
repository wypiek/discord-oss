import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { getIncidentHistory } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const MAX_PAGE = 400;

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        query: {
            page: { type: "number", required: false, description: "How many 3 month blocks to go back. 0 is the current one." },
        },
        description: "Resolved status page incidents of one 3 month block, newest first",
    }),
    async (req: Request, res: Response) => {
        const page = Number(req.query.page ?? 0);
        if (!Number.isInteger(page) || page < 0 || page > MAX_PAGE) throw new HTTPError(`page must be an integer from 0 to ${MAX_PAGE}`, 400);
        res.set("Cache-Control", "public, max-age=60");
        res.json(await getIncidentHistory(page));
    },
);

export default router;
