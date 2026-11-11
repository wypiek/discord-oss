import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "APIGeneralConfiguration",
            },
        },
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        const { general } = Config.get();
        res.json(general);
    },
);

export default router;
