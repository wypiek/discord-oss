import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        responses: {
            204: {},
        },
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        // TODO:
        res.sendStatus(204);
    },
);

export default router;
