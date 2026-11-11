import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Message } from "@spacebar/database";
import { Config, getPermission } from "@spacebar/util";
import { PreloadMessagesRequestSchema, PublicMessageListResponse } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "PreloadMessagesRequestSchema",
        responses: {
            200: {
                body: "PublicMessageListResponse",
            },
            400: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as PreloadMessagesRequestSchema;
        body.channels ??= body.channel_ids ?? [];
        if (body.channels.length > Config.get().limits.message.maxPreloadCount)
            return res.status(400).send({
                code: 400,
                message: `Cannot preload more than ${Config.get().limits.message.maxPreloadCount} channels at once.`,
            });

        const messages = (
            await Promise.all(
                [...new Set(body.channels)].map(async (channelId) => {
                    try {
                        const permissions = await getPermission(req.user_id, undefined, channelId);
                        if (!permissions.has("VIEW_CHANNEL") || !permissions.has("READ_MESSAGE_HISTORY")) return null;
                    } catch {
                        return null;
                    }

                    return Message.createQueryBuilder("message")
                        .setFindOptions({
                            where: { channel_id: channelId },
                            order: { timestamp: "DESC", id: "DESC" },
                            take: 1,
                        })
                        .andWhere("((message.flags & :ephemeral) != :ephemeral OR message.interaction_metadata ->> 'user_id' = :requester)", {
                            ephemeral: 64,
                            requester: req.user_id,
                        })
                        .getOne();
                }),
            )
        ).filter((x) => x !== null) as Message[];

        const filteredMessages = messages.map((message) => {
            const x = message.toJSON();
            x.reactions = undefined;
            return x;
        }) as unknown as PublicMessageListResponse;

        return res.status(200).send(filteredMessages);
    },
);

export default router;
