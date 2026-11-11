import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { getRevInfoOrFail } from "@spacebar/util";
import { SpacebarVersionResponse } from "@spacebar/schemas/api/spacebar/Version";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        responses: {
            200: {
                body: "SpacebarVersionResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json({
            implementation: "spacebar-server-ts",
            version: getRevInfoOrFail(),
        } satisfies SpacebarVersionResponse);
    },
);

export default router;
