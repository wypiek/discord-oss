import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { canViewGuildSpace, hydrateGuildSpace } from "@spacebar/api/util";
import { Guild, Member } from "@spacebar/database";
import { guildSpaceSettingsOf } from "@spacebar/schemas";
import { getPermission } from "@spacebar/util";

const MAX_WIDGET_IDS = 12;

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const guild_id = req.params.guild_id as string;
    await Member.IsInGuildOrFail(req.user_id, guild_id);
    const guild = await Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, guild_space: true } });
    const permission = await getPermission(req.user_id, guild_id);
    if (!canViewGuildSpace(guildSpaceSettingsOf(guild.guild_space), permission.has("MANAGE_GUILD"))) throw new HTTPError("Unknown Server Hub", 404);
    const raw = req.query.widget_ids;
    const widgetIds = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [])
        .map(String)
        .filter((id) => /^\d{1,20}$/.test(id))
        .slice(0, MAX_WIDGET_IDS);
    res.json(await hydrateGuildSpace(guild, req.user_id, widgetIds));
});

export default router;
