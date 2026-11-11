import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "APILimitsConfiguration",
            },
        },
        spacebarOnly: true,
        authentication: "optional",
    }),
    (req: Request, res: Response) => {
        const { limits } = Config.get();
        // TODO: handle rights
        res.json(limits);
    },
);

export default router;
