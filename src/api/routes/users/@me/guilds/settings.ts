import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { getAjv, UserGuildSettings } from "@spacebar/schemas";
import { UserFieldCaps } from "@spacebar/util/util/UserFieldCaps";

const router = Router({ mergeParams: true });

router.patch("/", route({}), async (req: Request, res: Response) => {
    const { guilds } = req.body as { guilds?: Record<string, Partial<UserGuildSettings>> };
    const requested = Object.entries(guilds ?? {});
    if (requested.length > UserFieldCaps.guildSettingsBulk)
        throw FieldErrors({ guilds: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${UserFieldCaps.guildSettingsBulk} or fewer in length.` } });
    const validate = getAjv().getSchema("UserGuildSettingsSchema");
    for (const [guild_id, settings] of requested)
        if (guild_id.length > 64 || (validate && !validate(settings)))
            throw FieldErrors({ [`guilds.${guild_id.slice(0, 64)}`]: { code: "BASE_TYPE_INVALID", message: "Invalid guild settings." } });

    const entries = await Promise.all(
        requested.map(([guild_id, settings]) => Member.updateGuildSettings(req.user_id, guild_id === "null" || guild_id === "@me" ? null : guild_id, settings)),
    );

    res.json(entries);
});

export default router;
