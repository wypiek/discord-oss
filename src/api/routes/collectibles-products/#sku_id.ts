import { route } from "@spacebar/api/middlewares";
import { remoteCollectibleProduct } from "@spacebar/api/util/utility/remoteCollectibles";
import { Collectibles, DiscordApiErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const sku_id = req.params.sku_id as string;
    const product = (await Collectibles.product(sku_id)) ?? (await remoteCollectibleProduct(sku_id));
    if (!product) throw DiscordApiErrors.UNKNOWN_SKU;
    res.json(product);
});

export default router;
