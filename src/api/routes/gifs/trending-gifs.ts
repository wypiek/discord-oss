import { route } from "@spacebar/api/middlewares";
import { GIF_QUERY_LIMITS, assertMaxLengths } from "@spacebar/api/util/utility/inputCaps";
import { Request, Response, Router } from "express";
import { GifMediaTypes } from "@spacebar/schemas";
import { GifProviderManager } from "@spacebar/integrations/gifs";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
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
        const provider = GifProviderManager.findProvider(req.query.provider as string);
        if (!provider) return res.status(503).json({ message: "This GIF provider is not configured." });
        const results = await provider.getTrendingGifs(req.query as typeof provider.getTrendingGifs.arguments).catch(() => null);
        if (results === null) return res.status(502).json({ message: "The GIF provider is temporarily unavailable." });
        res.json(results);
    },
);

export default router;
