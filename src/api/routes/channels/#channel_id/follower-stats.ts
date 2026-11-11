import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Guild, Webhook } from "@spacebar/database";
import { WebhookType } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ permission: "VIEW_CHANNEL", responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { channel_id } = req.params as Record<string, string>;
    const followers = await Webhook.find({
        where: { type: WebhookType.ChannelFollower, source_channel_id: channel_id },
        select: { id: true, guild_id: true },
    });
    const guildIds = [...new Set(followers.map((w) => w.guild_id).filter((id): id is string => !!id))];
    const guilds = guildIds.length ? await Guild.find({ where: { id: In(guildIds) }, select: { id: true, member_count: true } }) : [];
    const guildMembers = guilds.reduce((sum, g) => sum + (g.member_count ?? 0), 0);

    return res.json({
        channels_following: followers.length,
        guilds_following: guildIds.length,
        guild_members: guildMembers,
        users_seen_ever: guildMembers,
        subscribers_gained_since_last_post: 0,
        subscribers_lost_since_last_post: 0,
    });
});

export default router;
