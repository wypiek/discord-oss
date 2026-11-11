import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { StoreHiddenPack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStoreBuiltinPackUpdateSchema } from "@spacebar/schemas";
import { deleteStoreArt, uploadStoreArt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStoreBuiltinPackUpdateSchema",
        description: "Customize a mirrored pack locally, change visibility or restore its original metadata and artwork",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStoreBuiltinPackUpdateSchema;
        const sku_id = req.params.sku_id as string;
        if (!(await Collectibles.builtinCategories()).some((category) => category.sku_id === sku_id)) throw new HTTPError("Unknown pack", 404);
        const existing = await StoreHiddenPack.findOneBy({ sku_id });
        const hidden = body.hidden ?? existing?.hidden ?? false;
        const metadata = body.reset ? {} : { ...(existing?.customization ?? {}) };
        for (const field of ["name", "summary"] as const) {
            const value = body[field];
            if (value === undefined) continue;
            if (value === null) delete metadata[field];
            else {
                if (field === "name" && !value.trim()) throw new HTTPError("A pack needs a name", 400);
                metadata[field] = value.trim();
            }
        }
        if (body.position !== undefined) {
            if (body.position === null) delete metadata.position;
            else {
                if (!Number.isInteger(body.position) || body.position < -2147483648 || body.position > 2147483647) throw new HTTPError("position must be a 32-bit integer", 400);
                metadata.position = body.position;
            }
        }
        if (body.reset) for (const slot of ["banner", "logo"]) await deleteStoreArt(`builtin/${sku_id}/${slot}`);
        for (const slot of ["banner", "logo"] as const) {
            const data = body[`${slot}_data`];
            if (data === undefined) continue;
            const path = `builtin/${sku_id}/${slot}`;
            if (data === null) {
                await deleteStoreArt(path);
                delete metadata[`${slot}_hash`];
            } else metadata[`${slot}_hash`] = (await uploadStoreArt(path, data, `${slot}_data`)).hash;
        }
        if (hidden || Object.keys(metadata).length) await StoreHiddenPack.upsert({ sku_id, hidden, customization: metadata }, ["sku_id"]);
        else await StoreHiddenPack.delete({ sku_id });
        Collectibles.reload();
        const category = (await Collectibles.builtinCategories()).find((pack) => pack.sku_id === sku_id)!;
        res.json({
            sku_id,
            hidden,
            name: category.name,
            summary: category.summary ?? "",
            position: category.position ?? 0,
            banner: category.catalog_banner_url ?? category.hero_banner_url ?? null,
            logo: category.logo_url ?? null,
            customized: Object.keys(metadata).length > 0,
        });
    },
);

export default router;
