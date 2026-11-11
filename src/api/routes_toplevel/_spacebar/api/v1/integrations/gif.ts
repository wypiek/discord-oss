import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { GifProviderManager } from "@spacebar/integrations/gifs";
import { GifIntegrationsResponse } from "@spacebar/schemas/api/spacebar/Integrations";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        spacebarOnly: true,
        authentication: "never",
        responses: {
            200: {
                body: "GifIntegrationsResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        res.json({ providers: GifProviderManager.getProviders() } satisfies GifIntegrationsResponse);
    },
);

export default router;
