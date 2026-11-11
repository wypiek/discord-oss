import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Guild, SoundboardSound } from "@spacebar/database";

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
        const { sound_id, guild_id } = req.params as { [key: string]: string };
        const sound = await SoundboardSound.findOne({ where: { id: sound_id, guild_id } });
        const guild = sound && (await Guild.findOne({ where: { id: guild_id }, relations: { emojis: true } }));
        const discoverable = await guild?.toDiscoverableGuild();
        if (!discoverable) throw new HTTPError("Unknown Guild", 404);
        res.json(discoverable);
    },
);

export default router;
