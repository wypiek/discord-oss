import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { StoreItem, StorePack } from "@spacebar/database";
import { Collectibles } from "@spacebar/util";
import { AdminStorePackUpdateSchema } from "@spacebar/schemas";
import { clearStoreSelections, deleteStorePackArt, deleteStoreArt, serializeStorePack, uploadStoreArt } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const findPack = (req: Request) => StorePack.findOneOrFail({ where: { id: req.params.pack_id as string } });

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminStorePackUpdateSchema",
        description: "Change a store pack's name, summary, art or position",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminStorePackUpdateSchema;
        const pack = await findPack(req);
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("A pack needs a name", 400);
            pack.name = body.name.trim();
        }
        if (body.summary !== undefined) pack.summary = body.summary.trim();
        if (body.position !== undefined) pack.position = body.position;
        for (const slot of ["banner", "logo"] as const) {
            const data = body[`${slot}_data`];
            if (data === undefined) continue;
            if (data === null) {
                await deleteStoreArt(`${pack.id}/${slot}`);
                pack[`${slot}_hash`] = null;
            } else pack[`${slot}_hash`] = (await uploadStoreArt(`${pack.id}/${slot}`, data, `${slot}_data`)).hash;
        }
        await pack.save();
        Collectibles.reload();
        res.json(serializeStorePack(pack, await StoreItem.find({ where: { pack_id: pack.id } })));
    },
);

router.delete(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Delete a store pack and its items; people who have them stop seeing them on profiles",
        responses: { 204: {} },
    }),
    async (req: Request, res: Response) => {
        const pack = await findPack(req);
        const items = await StorePack.getRepository().manager.transaction(async (manager) => {
            await manager.findOneOrFail(StorePack, {
                where: { id: pack.id },
                lock: { mode: "pessimistic_write" },
            });
            const items = await manager
                .getRepository(StoreItem)
                .createQueryBuilder("item")
                .where("item.pack_id = :pack_id", { pack_id: pack.id })
                .setLock("pessimistic_write")
                .getMany();
            await clearStoreSelections(
                manager,
                items.map((item) => item.id),
            );
            await manager.delete(StorePack, { id: pack.id });
            return items;
        });
        Collectibles.reload();
        await deleteStorePackArt(pack, items);
        res.sendStatus(204);
    },
);

export default router;
