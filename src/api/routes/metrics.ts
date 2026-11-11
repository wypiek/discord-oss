import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

// screw off, telemetry requests
router.post(
    "/",
    route({
        responses: {
            204: {},
        },
        spacebarOnly: false, // Not part of public openapi
    }),
    (req: Request, res: Response) => {
        // TODO:
        res.sendStatus(204);
    },
);

router.post(
    "/v2",
    route({
        responses: {
            204: {},
        },
        spacebarOnly: false, // Not part of public openapi
    }),
    (req: Request, res: Response) => {
        // TODO:
        res.sendStatus(204);
    },
);

export default router;
