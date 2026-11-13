import { route } from "@spacebar/api/middlewares";
import { ConnectionStore } from "@spacebar/util";
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
        res.json(Object.fromEntries(Array.from(ConnectionStore.connections.values(), (connection) => [connection.id, { enabled: connection.isAvailable }])));
    },
);

export default router;
