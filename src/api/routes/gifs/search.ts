import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GIF_QUERY_LIMITS, assertMaxLengths } from "@spacebar/api/util/utility/inputCaps";
import { GifMediaTypes } from "@spacebar/schemas";
import { GifProviderManager } from "@spacebar/integrations/gifs";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            q: {
                type: "string",
                required: true,
                description: "Search query",
            },
            media_format: {
                type: "string",
                description: "Media format",
                values: Object.keys(GifMediaTypes).filter((key) => isNaN(Number(key))),
            },
            locale: {
                type: "string",
                description: "Locale",
            },
            limit: {
                type: "number",
                description: "Maximum number of GIFs to return",
            },
            provider: {
                type: "string",
                description: "Provider to use",
            },
        },
        responses: {
            200: {
                body: "GifsResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        assertMaxLengths(req.query, GIF_QUERY_LIMITS);
        const impl = GifProviderManager.findProvider(req.query.provider as string);
        if (!impl)
            return res.status(503).json({
                message: "This GIF provider is not configured. Ask the instance administrator to enable it.",
            });
        const result = await impl.search(req.query as typeof impl.search.arguments).catch(() => null);
        if (result === null)
            return res.status(502).json({
                message: "The GIF provider could not complete the search. Try again or choose another provider.",
            });
        res.json(result);
    },
);

export default router;
