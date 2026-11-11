import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { SpacebarWellKnownLegacyResponse } from "@spacebar/schemas/api/spacebar/WellKnown";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        deprecated: true,
        responses: {
            200: {
                body: "SpacebarWellKnownLegacyResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json({
            api: (Config.get().api.endpointPublic + "/api/").replace("//api/", "/api/"),
        } satisfies SpacebarWellKnownLegacyResponse);
    },
);

export default router;
