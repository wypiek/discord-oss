import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Channel, Tag } from "@spacebar/database";
import { ChannelUpdateEvent, FieldErrors, emitEvent } from "@spacebar/util";
import { TagCreateSchema } from "@spacebar/schemas";

const MAX_FORUM_TAGS = 20;

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "TagCreateSchema",
        permission: "MANAGE_CHANNELS",
        responses: {
            200: {
                body: "Channel",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as TagCreateSchema;
        const { channel_id } = req.params as Record<string, string>;

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { available_tags: true },
        });

        if (!channel.isForum()) throw new Error("is not thread only channel");
        if ((channel.available_tags?.length ?? 0) >= MAX_FORUM_TAGS)
            throw FieldErrors({ available_tags: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${MAX_FORUM_TAGS} or fewer in length.` } });

        const tag = Tag.create({
            channel,
            name: body.name,
            moderated: body.moderated || false,
            emoji_id: body.emoji_id || undefined,
            emoji_name: body.emoji_name || undefined,
            position: Math.max(-1, ...(channel.available_tags ?? []).map((t) => t.position)) + 1,
        });
        channel.available_tags?.push(tag);

        await Promise.all([
            tag.save(),
            emitEvent({
                event: "CHANNEL_UPDATE",
                data: channel.toJSON(),
                channel_id,
            } satisfies ChannelUpdateEvent),
        ]);

        res.json(channel.toJSON());
    },
);

router.put(
    "/:tag_id",
    route({
        requestBody: "TagCreateSchema",
        permission: "MANAGE_CHANNELS",
        responses: {
            200: {
                body: "Channel",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as TagCreateSchema;
        const { channel_id, tag_id } = req.params as Record<string, string>;

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { available_tags: true },
        });

        if (!channel.isForum()) throw new Error("is not thread only channel");

        const tag = channel.available_tags?.find((tag) => tag.id == tag_id);
        //TODO better error
        if (!tag) throw new HTTPError("Tag not found");
        tag.assign(body);

        await Promise.all([
            tag.save(),
            emitEvent({
                event: "CHANNEL_UPDATE",
                data: channel.toJSON(),
                channel_id,
            } satisfies ChannelUpdateEvent),
        ]);

        res.json(channel.toJSON());
    },
);

router.delete(
    "/:tag_id",
    route({
        permission: "MANAGE_CHANNELS",
        responses: {
            200: {
                body: "Channel",
            },
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id, tag_id } = req.params as Record<string, string>;

        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
            relations: { available_tags: true },
        });

        if (!channel.isForum()) throw new Error("is not thread only channel");

        const tag = channel.available_tags?.find((t) => t.id === tag_id);
        if (!tag) throw new HTTPError("Tag not found", 404);
        channel.available_tags = channel.available_tags?.filter((t) => t.id !== tag.id);

        await Promise.all([
            tag.remove(),
            emitEvent({
                event: "CHANNEL_UPDATE",
                data: channel.toJSON(),
                channel_id,
            } satisfies ChannelUpdateEvent),
        ]);

        res.json(channel.toJSON());
    },
);

export default router;
