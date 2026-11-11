import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { CollectiblesMarketingResponse } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

// Unsure what this endpoint does, it seems to only affect the visual style of the shop tab in home
router.get(
    "/",
    route({
        responses: {
            200: {
                body: "CollectiblesMarketingResponse",
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
    (req: Request, res: Response) => {
        res.send({
            marketings: {},
        } as CollectiblesMarketingResponse);
    },
);

export default router;
