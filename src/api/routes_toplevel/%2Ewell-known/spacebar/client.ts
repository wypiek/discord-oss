import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { SpacebarWellKnownClientResponse } from "@spacebar/schemas/api/spacebar/WellKnown";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        responses: {
            200: {
                body: "SpacebarWellKnownClientResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json({
            api: {
                baseUrl: Config.get().api.endpointPublic!.split("/api/")[0],
                apiVersions: {
                    default: Config.get().api.defaultVersion,
                    active: Config.get().api.activeVersions,
                },
            },
            cdn: {
                baseUrl: Config.get().cdn.endpointPublic!,
            },
            gateway: {
                baseUrl: Config.get().gateway.endpointPublic!,
                encoding: ["etf", "json"],
                compression: ["zstd-stream", "zlib-stream", null],
            },
            admin:
                Config.get().admin.endpointPublic === null
                    ? undefined
                    : {
                          baseUrl: Config.get().admin.endpointPublic!,
                      },
        } satisfies SpacebarWellKnownClientResponse);
    },
);

export default router;
