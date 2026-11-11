import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { GIF_QUERY_LIMITS, assertMaxLengths } from "@spacebar/api/util/utility/inputCaps";
import { GifProviderManager } from "@spacebar/integrations/gifs";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            q: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Maximum number of suggestions" },
            locale: { type: "string", description: "Locale" },
            provider: { type: "string", description: "Provider to use" },
        },
        responses: { 200: {} },
    }),
    async (req: Request, res: Response) => {
        assertMaxLengths(req.query, GIF_QUERY_LIMITS);
        const provider = GifProviderManager.findProvider(req.query.provider as string);
        const q = String(req.query.q ?? "").trim();
        if (!provider?.suggest || !q) return res.json([]);
        res.json(
            await provider
                .suggest({
                    q,
                    limit: Number(req.query.limit) || 5,
                    locale: (req.query.locale as string) ?? "en",
                })
                .catch(() => []),
        );
    },
);

export default router;
