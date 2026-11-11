import { Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { GifProviderManager } from "@spacebar/integrations/gifs";
const router = Router({ mergeParams: true });
router.get("/", route({}), (_req, res) =>
    res.json({
        defaultProvider: Config.get().integrations.gifs.defaultProvider,
        providers: GifProviderManager.getProviders(),
    }),
);
export default router;
