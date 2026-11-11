import { route } from "@spacebar/api/middlewares";
import { grantCollectible } from "@spacebar/api/util";
import { DiscordApiErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.put("/", route({}), async (req: Request, res: Response) => {
    const { sku_id } = (req.body ?? {}) as { sku_id?: string };
    if (typeof sku_id !== "string") throw DiscordApiErrors.UNKNOWN_SKU;
    res.json(await grantCollectible(req.user_id, sku_id));
});

export default router;
