import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Sticker } from "@spacebar/database";

const router = Router({ mergeParams: true });
const LIMIT = 1000;

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "List a server's stickers, up to 1,000",
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true } });
        const stickers = await Sticker.find({
            where: { guild_id },
            select: { id: true, name: true, description: true, tags: true, format_type: true, available: true, user_id: true },
            order: { id: "ASC" },
            take: LIMIT + 1,
        });
        res.json({
            truncated: stickers.length > LIMIT,
            stickers: stickers.slice(0, LIMIT).map((sticker) => ({
                id: sticker.id,
                name: sticker.name,
                description: sticker.description ?? null,
                tags: sticker.tags ?? "",
                format_type: sticker.format_type,
                available: sticker.available ?? true,
                url: `/stickers/${sticker.id}.${sticker.format_type === 4 ? "gif" : "png"}`,
            })),
        });
    },
);

export default router;
