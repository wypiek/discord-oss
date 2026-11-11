import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { StoreItem, StorePack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStoreItemCreateSchema } from "@spacebar/schemas";
import { applyStoreArt, applyStoreItemSettings, deleteAllStoreArt, serializeStoreItem, storeItemComplete } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStoreItemCreateSchema",
        description: "Add an avatar decoration, profile effect, nameplate or profile frame to a store pack",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStoreItemCreateSchema;
        const pack = await StorePack.findOneOrFail({ where: { id: req.params.pack_id as string } });
        const item = StoreItem.create({
            pack_id: pack.id,
            type: body.type,
            name: body.name.trim(),
            summary: body.summary?.trim() ?? "",
            label: body.label?.trim() ?? "",
            position: body.position ?? 0,
            data: {},
        });
        if (!item.name) throw new HTTPError("An item needs a name", 400);
        applyStoreItemSettings(item, body);
        await applyStoreArt(item, body.art);
        if (!storeItemComplete(item)) {
            await deleteAllStoreArt(item);
            throw new HTTPError("This item is missing its main art, see the art field for what each type needs", 400);
        }
        await item.save();
        Collectibles.reload();
        res.status(201).json(serializeStoreItem(item));
    },
);

export default router;
