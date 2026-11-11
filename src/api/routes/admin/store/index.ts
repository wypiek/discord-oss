import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { StoreHiddenPack, StoreItem, StorePack } from "@spacebar/database";
import { Collectibles, CollectibleItemType } from "@spacebar/util";
import {
    EFFECT_HEIGHT,
    EFFECT_WIDTH,
    FRAME_INNER_WIDTH,
    FRAME_OVERFLOW_HORIZONTAL,
    NAMEPLATE_PALETTES,
    groupStoreItems,
    serializeStorePack,
    sortStoreByPosition,
} from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const COUNTED_TYPES = [CollectibleItemType.AVATAR_DECORATION, CollectibleItemType.PROFILE_EFFECT, CollectibleItemType.NAMEPLATE, CollectibleItemType.PROFILE_FRAME];

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "The store's own packs and items, and the mirrored discord packs with whether each is in the shop",
    }),
    async (req: Request, res: Response) => {
        const [packs, items, hidden, builtin] = await Promise.all([StorePack.find(), StoreItem.find(), StoreHiddenPack.find(), Collectibles.builtinCategories()]);
        const grouped = groupStoreItems(items);
        const hiddenSkus = new Set(hidden.filter((x) => x.hidden !== false).map((x) => x.sku_id));
        res.json({
            packs: packs.sort(sortStoreByPosition).map((pack) => serializeStorePack(pack, grouped)),
            builtin: builtin
                .filter((category) => category.products.length)
                .map((category) => ({
                    sku_id: category.sku_id,
                    name: category.name,
                    summary: category.summary ?? "",
                    position: category.position ?? 0,
                    customized: category.customized ?? false,
                    logo: category.logo_url ?? null,
                    banner: category.catalog_banner_url ?? category.hero_banner_url ?? null,
                    // counted by what's in them, bundles included
                    items: category.products.reduce((sum, product) => sum + (product.items ?? []).filter((item) => COUNTED_TYPES.includes(item.type)).length, 0),
                    hidden: hiddenSkus.has(category.sku_id),
                })),
            palettes: NAMEPLATE_PALETTES,
            sizes: {
                effect: { width: EFFECT_WIDTH, height: EFFECT_HEIGHT },
                frame: {
                    width: FRAME_INNER_WIDTH + FRAME_OVERFLOW_HORIZONTAL * 2,
                    inner_width: FRAME_INNER_WIDTH,
                },
            },
        });
    },
);

export default router;
