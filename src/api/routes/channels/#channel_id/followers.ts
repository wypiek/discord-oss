import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { sendMessage } from "@spacebar/api/util";
import { Channel, Guild, Webhook } from "@spacebar/database";
import { Config, DiscordApiErrors, emitEvent, FieldErrors, getPermission } from "@spacebar/util";
import { ChannelType, MessageType, WebhookType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        permission: "VIEW_CHANNEL",
        responses: {
            200: {},
            400: { body: "APIErrorResponse" },
            403: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as Record<string, string>;
        const { webhook_channel_id } = req.body as { webhook_channel_id?: string };
        if (!webhook_channel_id)
            throw FieldErrors({
                webhook_channel_id: { code: "BASE_TYPE_REQUIRED", message: "This field is required" },
            });

        const [source, target] = await Promise.all([Channel.findOneOrFail({ where: { id: channel_id } }), Channel.findOne({ where: { id: webhook_channel_id } })]);
        if (source.type !== ChannelType.GUILD_NEWS) throw DiscordApiErrors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE;
        if (!target?.guild_id || ![ChannelType.GUILD_TEXT, ChannelType.GUILD_NEWS].includes(target.type)) throw DiscordApiErrors.UNKNOWN_CHANNEL;
        (await getPermission(req.user_id, target.guild_id, target)).hasThrow("MANAGE_WEBHOOKS");

        const existing = await Webhook.findOne({
            where: {
                type: WebhookType.ChannelFollower,
                channel_id: target.id,
                source_channel_id: source.id,
            },
        });
        if (existing) return res.json({ channel_id: source.id, webhook_id: existing.id });

        const { maxWebhooks } = Config.get().limits.channel;
        if (maxWebhooks && (await Webhook.count({ where: { channel_id: target.id } })) >= maxWebhooks) throw DiscordApiErrors.MAXIMUM_WEBHOOKS.withParams(maxWebhooks);

        const sourceGuild = await Guild.findOneOrFail({
            where: { id: source.guild_id },
            select: { id: true, name: true, icon: true },
        });
        const webhook = await Webhook.create({
            type: WebhookType.ChannelFollower,
            name: `${sourceGuild.name} #${source.name}`.slice(0, 80),
            avatar: sourceGuild.icon ?? undefined,
            guild_id: target.guild_id,
            channel_id: target.id,
            user_id: req.user_id,
            source_guild_id: sourceGuild.id,
            source_channel_id: source.id,
        }).save();

        await Promise.all([
            emitEvent({
                event: "WEBHOOKS_UPDATE",
                data: { guild_id: target.guild_id, channel_id: target.id },
                guild_id: target.guild_id,
            }),
            sendMessage({
                channel_id: target.id,
                type: MessageType.CHANNEL_FOLLOW_ADD,
                content: `${sourceGuild.name} #${source.name}`,
                author_id: req.user_id,
            }),
        ]);

        return res.json({ channel_id: source.id, webhook_id: webhook.id });
    },
);

export default router;
