import { route } from "@spacebar/api/middlewares";
import { listCollectiblePurchases } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                // body: "CollectiblesPurchasesResponse",
            },
            204: {},
            401: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        res.json(await listCollectiblePurchases(req.user_id));
    },
);

export default router;
