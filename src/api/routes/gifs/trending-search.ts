import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GIF_QUERY_LIMITS, assertMaxLengths } from "@spacebar/api/util/utility/inputCaps";
import { GifProviderManager } from "@spacebar/integrations/gifs";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            limit: { type: "number", description: "Maximum number of terms" },
            locale: { type: "string", description: "Locale" },
            provider: { type: "string", description: "Provider to use" },
        },
        responses: { 200: {} },
    }),
    async (req: Request, res: Response) => {
        assertMaxLengths(req.query, GIF_QUERY_LIMITS);
        const provider = GifProviderManager.findProvider(req.query.provider as string);
        if (!provider) return res.json([]);
        const categories = await provider.getTrendingCategories({ media_format: "gif", locale: (req.query.locale as string) ?? "en" }).catch(() => []);
        res.json(categories.slice(0, Number(req.query.limit) || 5).map((category) => category.name));
    },
);

export default router;
