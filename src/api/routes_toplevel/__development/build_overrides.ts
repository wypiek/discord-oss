import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        authentication: "never",
        responses: { 200: {} },
    }),
    (req: Request, res: Response) => {
        res.json({});
    },
);

export default router;
