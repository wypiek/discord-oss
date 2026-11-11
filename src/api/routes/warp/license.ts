import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

// Don't care, maybe some day figure out the response schema, but we have no good way to respond to this
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

export default router;
