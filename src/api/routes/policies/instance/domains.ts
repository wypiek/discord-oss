import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { Request, Response, Router } from "express";
const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "InstanceDomainsResponse",
            },
        },
        spacebarOnly: true,
        authentication: "never",
    }),
    (req: Request, res: Response) => {
        const { cdn, gateway, api } = Config.get();

        res.json({
            admin: Config.get().admin.endpointPublic,
            api: (Config.get().api.endpointPublic + "/api/").replace("//api/", "/api/"), // Transitional, see /.well-known/spacebar/client
            apiEndpoint: api.endpointPublic,
            cdn: cdn.endpointPublic,
            defaultApiVersion: api.defaultVersion,
            gateway: gateway.endpointPublic,
        });
    },
);

export default router;
