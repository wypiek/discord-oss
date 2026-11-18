import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { canViewGuildSpace, loadGuildSpace, serializeGuildSpace, updateGuildSpace } from "@spacebar/api/util";
import { Member } from "@spacebar/database";
import { guildSpaceSettingsOf, GuildSpaceUpdateSchema } from "@spacebar/schemas";
import { getPermission } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const guild_id = req.params.guild_id as string;
    await Member.IsInGuildOrFail(req.user_id, guild_id);
    const permission = await getPermission(req.user_id, guild_id);
    const guild = await loadGuildSpace(guild_id);
    if (!canViewGuildSpace(guildSpaceSettingsOf(guild.guild_space), permission.has("MANAGE_GUILD"))) throw new HTTPError("Unknown Server Hub", 404);
    res.json(serializeGuildSpace(guild));
});

router.put("/", route({ requestBody: "GuildSpaceUpdateSchema", permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const guild = await updateGuildSpace(req.params.guild_id as string, req.body as GuildSpaceUpdateSchema);
    res.json(serializeGuildSpace(guild));
});

export default router;
