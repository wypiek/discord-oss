import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "ApplicationEntitlementsResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        // TODO:
        //const { exclude_consumed } = req.query;
        res.status(200).send([]);
    },
);

export default router;
