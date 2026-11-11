import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { StoreItem, StorePack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStoreItemUpdateSchema } from "@spacebar/schemas";
import { applyStoreArt, applyStoreItemSettings, assertKeepsMainArt, clearStoreSelections, deleteAllStoreArt, serializeStoreItem } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const findItem = (req: Request) => StoreItem.findOneOrFail({ where: { id: req.params.item_id as string } });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStoreItemUpdateSchema",
        description: "Change a store item's details or art, or move it to another custom pack",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStoreItemUpdateSchema;
        const item = await findItem(req);
        if (body.pack_id !== undefined && body.pack_id !== item.pack_id) {
            if (typeof body.pack_id !== "string" || !/^\d{1,20}$/.test(body.pack_id) || BigInt(body.pack_id) > 9223372036854775807n)
                throw new HTTPError("pack_id must be a valid custom pack id", 400);
            const destinationId = BigInt(body.pack_id).toString();
            if (destinationId !== item.pack_id && !(await StorePack.existsBy({ id: destinationId }))) throw new HTTPError("The destination custom pack does not exist", 404);
            item.pack_id = destinationId;
        }
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("An item needs a name", 400);
            item.name = body.name.trim();
        }
        if (body.summary !== undefined) item.summary = body.summary.trim();
        if (body.label !== undefined) item.label = body.label.trim();
        if (body.position !== undefined) item.position = body.position;
        applyStoreItemSettings(item, body);
        // removing the main art would take the item out of the shop and off everyone's profile
        assertKeepsMainArt(item, body.art);
        await applyStoreArt(item, body.art);
        item.data = { ...item.data };
        await item.save();
        Collectibles.reload();
        res.json(serializeStoreItem(item));
    },
);

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Delete a store item; people who have it stop seeing it on profiles",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const item = await findItem(req);
        await StoreItem.getRepository().manager.transaction(async (manager) => {
            await manager.findOneOrFail(StoreItem, {
                where: { id: item.id },
                lock: { mode: "pessimistic_write" },
            });
            await clearStoreSelections(manager, [item.id]);
            await manager.delete(StoreItem, { id: item.id });
        });
        Collectibles.reload();
        await deleteAllStoreArt(item);
        res.sendStatus(204);
    },
);

export default router;
