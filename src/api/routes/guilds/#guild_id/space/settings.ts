import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { updateGuildSpaceSettings } from "@spacebar/api/util";
import { Guild } from "@spacebar/database";
import { guildSpaceSettingsOf, GuildSpaceSettingsModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const guild = await Guild.findOneOrFail({ where: { id: req.params.guild_id as string }, select: { id: true, guild_space: true } });
    res.json(guildSpaceSettingsOf(guild.guild_space));
});

router.patch("/", route({ requestBody: "GuildSpaceSettingsModifySchema", permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    res.json(await updateGuildSpaceSettings(req.params.guild_id as string, req.body as GuildSpaceSettingsModifySchema));
});

export default router;
