import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "ApplicationSkusResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json([]).status(200);
    },
);

export default router;
