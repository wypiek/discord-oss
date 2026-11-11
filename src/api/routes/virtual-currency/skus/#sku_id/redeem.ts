import { route } from "@spacebar/api/middlewares";
import { grantCollectible } from "@spacebar/api/util";
import { Collectibles, DiscordApiErrors, sellsForOrbs, Snowflake } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

const VIRTUAL_CURRENCY_REDEMPTION = 12;
const COLLECTIBLES_APPLICATION_ID = "521842831262875670";

router.post("/", route({ responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const sku_id = req.params.sku_id as string;
    const product = await Collectibles.product(sku_id);
    if (!product || !sellsForOrbs(product)) throw DiscordApiErrors.UNKNOWN_SKU;
    await grantCollectible(req.user_id, sku_id);
    const granted = await Collectibles.grantable(sku_id);
    res.json(
        granted.map((sku) => ({
            id: Snowflake.generate(),
            sku_id: sku,
            application_id: COLLECTIBLES_APPLICATION_ID,
            user_id: req.user_id,
            type: VIRTUAL_CURRENCY_REDEMPTION,
            deleted: false,
            consumed: false,
            gift_code_flags: 0,
            starts_at: null,
            ends_at: null,
        })),
    );
});

export default router;
