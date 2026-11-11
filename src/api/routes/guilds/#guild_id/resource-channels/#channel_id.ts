import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { fieldCaps } from "@spacebar/api/util/utility/fieldCaps";

const router = Router({ mergeParams: true });

router.put("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id, channel_id } = req.params as { [key: string]: string };
    const { icon } = (req.body ?? {}) as { icon?: string | null };
    const caps = fieldCaps();
    caps.text("icon", icon, 64);
    caps.check();

    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, home_settings: true } });
    const resource = guild.home_settings?.resource_channels.find((item) => item.channel_id === channel_id);
    if (!guild.home_settings || !resource) throw DiscordApiErrors.UNKNOWN_CHANNEL;
    resource.icon = icon ?? null;
    if (icon) resource.emoji = null;
    await Guild.update({ id: guild_id }, { home_settings: guild.home_settings });
    res.json(resource);
});

export default router;
