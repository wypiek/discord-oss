import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Emoji } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {},
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { emoji_id } = req.params as { [key: string]: string };
        const emoji = await Emoji.findOne({
            where: { id: emoji_id },
            relations: { guild: { emojis: true } },
        });
        if (!emoji) throw DiscordApiErrors.UNKNOWN_EMOJI;
        const guild = await emoji.guild?.toDiscoverableGuild();
        if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;
        res.json(guild);
    },
);

export default router;
