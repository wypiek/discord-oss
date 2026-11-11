import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Emoji, Guild, User } from "@spacebar/database";

const router = Router({ mergeParams: true });
const LIMIT = 1000;

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "List a server's custom emoji, up to 1,000, with who uploaded each",
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true } });
        const emojis = await Emoji.find({
            where: { guild_id },
            select: { id: true, name: true, animated: true, available: true, managed: true, user_id: true },
            order: { id: "ASC" },
            take: LIMIT + 1,
        });
        const shown = emojis.slice(0, LIMIT);
        const uploaderIds = [...new Set(shown.map((emoji) => emoji.user_id).filter(Boolean))];
        const uploaders = new Map(
            (uploaderIds.length ? await User.find({ where: { id: In(uploaderIds) }, select: { id: true, username: true, global_name: true } }) : []).map((user) => [user.id, user]),
        );
        res.json({
            truncated: emojis.length > LIMIT,
            emojis: shown.map((emoji) => ({
                id: emoji.id,
                name: emoji.name,
                animated: emoji.animated,
                available: emoji.available,
                managed: emoji.managed,
                uploader: emoji.user_id
                    ? { id: emoji.user_id, username: uploaders.get(emoji.user_id)?.username ?? null, global_name: uploaders.get(emoji.user_id)?.global_name ?? null }
                    : null,
            })),
        });
    },
);

export default router;
