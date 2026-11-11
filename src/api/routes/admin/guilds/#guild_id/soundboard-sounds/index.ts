import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, SoundboardSound } from "@spacebar/database";

const router = Router({ mergeParams: true });
const LIMIT = 1000;

router.get(
    "/",
    route({
        right: "MANAGE_GUILDS",
        spacebarOnly: true,
        description: "List a server's soundboard sounds, up to 1,000",
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true } });
        const sounds = await SoundboardSound.find({ where: { guild_id }, relations: { user: true }, order: { id: "ASC" }, take: LIMIT + 1 });
        res.json({
            truncated: sounds.length > LIMIT,
            sounds: sounds.slice(0, LIMIT).map((sound) => ({
                id: sound.id,
                name: sound.name,
                volume: sound.volume,
                emoji_id: sound.emoji_id ?? null,
                emoji_name: sound.emoji_name ?? null,
                available: sound.available,
                url: `/soundboard-sounds/${sound.id}`,
                uploader: sound.user ? { id: sound.user.id, username: sound.user.username, global_name: sound.user.global_name ?? null } : null,
            })),
        });
    },
);

export default router;
