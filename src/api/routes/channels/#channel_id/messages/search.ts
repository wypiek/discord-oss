import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { getSearchableChannels, searchMessages, searchResponse, searchTabs } from "@spacebar/api/util";
import { Channel } from "@spacebar/database";
import { getPermission } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

const searchable = async (userId: string, channelId: string) => {
    const channel = await Channel.findOneOrFail({ where: { id: channelId } });
    (await getPermission(userId, channel.guild_id ?? undefined, channelId)).hasThrow("VIEW_CHANNEL");
    return getSearchableChannels(userId, channel.guild_id ?? undefined, [channelId]);
};

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GuildMessagesSearchResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            422: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const channels = await searchable(req.user_id, channel_id);
        res.json(searchResponse(req.user_id, await searchMessages(req.user_id, channels, { include_nsfw: true, ...req.query })));
    },
);

router.post(
    "/tabs",
    route({
        responses: {
            200: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const channels = await searchable(req.user_id, channel_id);
        res.json(await searchTabs(req.user_id, channels, { include_nsfw: true, ...req.body }));
    },
);

export default router;
