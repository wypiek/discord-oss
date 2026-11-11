import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { getSearchableChannels, searchTabs } from "@spacebar/api/util";

const router: Router = Router({ mergeParams: true });

router.post(
    "/tabs",
    route({
        responses: {
            200: {},
        },
    }),
    async (req: Request, res: Response) => {
        const ids = req.body.channel_ids === undefined ? [] : (Array.isArray(req.body.channel_ids) ? req.body.channel_ids : [req.body.channel_ids]).map(String);
        const channels = await getSearchableChannels(req.user_id, undefined, ids);
        res.json(await searchTabs(req.user_id, channels, { include_nsfw: true, ...req.body }));
    },
);

export default router;
