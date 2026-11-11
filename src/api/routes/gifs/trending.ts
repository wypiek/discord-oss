import { route } from "@spacebar/api/middlewares";
import { GIF_QUERY_LIMITS, assertMaxLengths } from "@spacebar/api/util/utility/inputCaps";
import { Request, Response, Router } from "express";
import { TrendingGifsResponse } from "@spacebar/schemas";
import { GifProviderManager } from "@spacebar/integrations/gifs";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            locale: {
                type: "string",
                description: "Locale",
            },
            provider: {
                type: "string",
                description: "Provider to use",
            },
        },
        responses: {
            200: {
                body: "TrendingGifsResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        assertMaxLengths(req.query, GIF_QUERY_LIMITS);
        const provider = GifProviderManager.findProvider(req.query.provider as string);
        if (!provider) return res.status(503).json({ message: "This GIF provider is not configured." });

        const [trendingCategories, trendingGifs] = await Promise.all([
            provider.getTrendingCategories(req.query as typeof provider.getTrendingCategories.arguments).catch(() => null),
            provider.getTrendingGifs(req.query as typeof provider.getTrendingGifs.arguments).catch(() => null),
        ]);

        if (trendingCategories === null || trendingGifs === null) return res.status(502).json({ message: "The GIF provider is temporarily unavailable." });
        res.json({
            categories: trendingCategories,
            gifs: trendingGifs,
        } satisfies TrendingGifsResponse);
    },
);

export default router;
