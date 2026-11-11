import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GatewayResponse",
            },
        },
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        const { endpointPublic } = Config.get().gateway;
        res.json({
            url: endpointPublic,
        });
    },
);

export default router;
