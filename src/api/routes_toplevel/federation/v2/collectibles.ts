import { Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { CollectibleItemType, Collectibles, FederationRequestError, parseCanonicalId } from "@spacebar/util";
import { federationHandler, ownInstance } from "@spacebar/api/util/utility/federationNetwork";

const router = Router({ mergeParams: true });

router.get(
    "/:sku_id",
    route({
        spacebarOnly: true,
        authentication: "never",
        description:
            "A profile effect or avatar decoration of this instance's shop by canonical SKU, so other instances can show it and let this instance's users wear it there. Needs a signed request.",
    }),
    federationHandler(async (req) => {
        const parsed = parseCanonicalId(req.params.sku_id);
        const item =
            parsed?.instance === ownInstance()
                ? ((await Collectibles.item(parsed.id, CollectibleItemType.PROFILE_EFFECT)) ?? (await Collectibles.item(parsed.id, CollectibleItemType.AVATAR_DECORATION)))
                : undefined;
        if (!parsed || !item) throw new FederationRequestError("unknown_sku", "Unknown profile effect or avatar decoration", 404);
        const product = await Collectibles.product(parsed.id);
        return { body: { name: product?.name ?? item.title ?? null, item } };
    }),
);

export default router;
