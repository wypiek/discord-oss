import { route } from "@spacebar/api/middlewares";
import { ConnectionConfig } from "@spacebar/util";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        authentication: "optional",
        responses: {
            200: {
                body: "APIConnectionsConfiguration",
            },
        },
    }),
    (req: Request, res: Response) => {
        const config = ConnectionConfig.get() as Record<string, { enabled?: boolean }>;
        res.json({
            ...Object.fromEntries(Object.entries(config).map(([key, value]) => [key, { enabled: !!value?.enabled }])),
            domain: { enabled: true },
        });
    },
);

export default router;
