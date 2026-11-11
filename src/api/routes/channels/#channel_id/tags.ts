import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { removeAppliedTags } from "@spacebar/api/util";
import { Channel, Tag } from "@spacebar/database";
import { ChannelUpdateEvent, DiscordApiErrors, FieldErrors, emitEvent } from "@spacebar/util";
import { TagCreateSchema } from "@spacebar/schemas";

const MAX_FORUM_TAGS = 20;

const router: Router = Router({ mergeParams: true });

const getForum = async (channel_id: string) => {
    const channel = await Channel.findOneOrFail({
        where: { id: channel_id },
        relations: { available_tags: true },
    });
    if (!channel.isForum()) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
    return channel;
};

const emitForumUpdate = (channel: Channel) =>
    emitEvent({
        event: "CHANNEL_UPDATE",
        data: channel.toJSON(),
        guild_id: channel.guild_id ?? undefined,
        channel_id: channel.id,
    } satisfies ChannelUpdateEvent);

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

        const channel = await getForum(channel_id);
        if ((channel.available_tags?.length ?? 0) >= MAX_FORUM_TAGS)
            throw FieldErrors({ available_tags: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${MAX_FORUM_TAGS} or fewer in length.` } });

        const tag = Tag.create({
            channel_id: channel.id,
            position: Math.max(-1, ...(channel.available_tags ?? []).map((t) => t.position)) + 1,
        }).assignInput(body);
        await tag.save();
        channel.available_tags = [...(channel.available_tags ?? []), tag];
        await emitForumUpdate(channel);

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

        const channel = await getForum(channel_id);
        const tag = channel.available_tags?.find((tag) => tag.id === tag_id);
        if (!tag) throw new HTTPError("Tag not found", 404);
        await tag.assignInput(body).save();
        await emitForumUpdate(channel);

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

        const channel = await getForum(channel_id);
        const tag = channel.available_tags?.find((t) => t.id === tag_id);
        if (!tag) throw new HTTPError("Tag not found", 404);
        channel.available_tags = channel.available_tags?.filter((t) => t.id !== tag.id);

        await tag.remove();
        await removeAppliedTags(channel.id, [tag_id]);
        await emitForumUpdate(channel);

        res.json(channel.toJSON());
    },
);

export default router;
