import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { GuildHomeSettings } from "@spacebar/schemas";
import { emojiCaps, fieldCaps } from "@spacebar/api/util/utility/fieldCaps";

const router = Router({ mergeParams: true });

const homeSettings = (guild_id: string) => Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, home_settings: true } });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const [guild, member] = await Promise.all([
        homeSettings(guild_id),
        Member.findOne({ where: { id: req.user_id, guild_id }, select: { index: true, id: true, completed_new_member_actions: true } }),
    ]);
    if (!member) throw DiscordApiErrors.UNKNOWN_MEMBER;
    const actions = new Set((guild.home_settings?.new_member_actions ?? []).map((action) => action.channel_id));
    const completed = (member.completed_new_member_actions ?? []).filter((channel_id) => actions.has(channel_id));
    res.json({ channel_actions: Object.fromEntries(completed.map((channel_id) => [channel_id, { completed: true }])) });
});

router.patch("/:channel_id", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id, channel_id } = req.params as { [key: string]: string };
    const body = (req.body ?? {}) as { emoji?: GuildHomeSettings["new_member_actions"][number]["emoji"]; icon?: string | null };
    const caps = fieldCaps();
    emojiCaps(caps, "emoji", body.emoji);
    caps.text("icon", body.icon, 64);
    caps.check();

    const guild = await homeSettings(guild_id);
    const actions = guild.home_settings?.new_member_actions ?? [];
    const action = actions.find((item) => item.channel_id === channel_id);
    if (!guild.home_settings || !action) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    if (body.emoji !== undefined) {
        action.emoji = body.emoji;
        action.icon = null;
    } else if (body.icon !== undefined) {
        action.icon = body.icon;
        action.emoji = null;
    }
    await Guild.update({ id: guild_id }, { home_settings: guild.home_settings });
    res.json(action);
});

export default router;
