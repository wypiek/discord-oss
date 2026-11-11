import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Sticker } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "Sticker",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { sticker_id } = req.params as { [key: string]: string };

        res.json(await Sticker.findOne({ where: { id: sticker_id } }));
    },
);
router.get(
    "/guild",
    route({
        responses: {
            200: {
                body: "Sticker",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { sticker_id } = req.params as { [key: string]: string };
        const sticker = await Sticker.findOne({
            where: { id: sticker_id },
            relations: { guild: true },
        });
        res.json(await sticker?.guild?.toDiscoverableGuild());
    },
);

export default router;
