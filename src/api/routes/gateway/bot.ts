import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GatewayBotResponse",
            },
        },
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        const { endpointPublic } = Config.get().gateway;
        res.json({
            url: endpointPublic,
            shards: 1,
            session_start_limit: {
                total: 1000,
                remaining: 999,
                reset_after: 14400000,
                max_concurrency: 1,
            },
        });
    },
);

export default router;
