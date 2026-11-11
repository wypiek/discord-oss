import { route } from "@spacebar/api/middlewares";
import { HubDirectoryEntriesResponse } from "@spacebar/schemas";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "HubDirectoryEntriesResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json([] as HubDirectoryEntriesResponse);
    },
);

export default router;
