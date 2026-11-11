import { getVoiceRegions } from "@spacebar/api/util";
import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "VoiceRegionListResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        res.json(await getVoiceRegions(req.ip!, true)); //vip true?
    },
);

export default router;
