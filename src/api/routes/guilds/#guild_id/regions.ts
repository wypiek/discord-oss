import { getVoiceRegions } from "@spacebar/api/util";
import { route } from "@spacebar/api/middlewares";
import { Guild } from "@spacebar/database";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "VoiceRegionListResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        //TODO we should use an enum for guild's features and not hardcoded strings
        return res.json(await getVoiceRegions(req.ip!, guild.features.includes("VIP_REGIONS")));
    },
);

export default router;
