import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ApplicationCommandPermission, Member } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const guildId = req.params.guild_id as string;
    const applicationId = req.params.application_id as string;
    if (!(await Member.exists({ where: { guild_id: guildId, id: applicationId } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    const index = await buildCommandIndex([applicationId], { guildId });
    const permissions = await ApplicationCommandPermission.find({
        where: { guild_id: guildId, application_id: applicationId },
    });
    res.json({
        application_commands: index.application_commands,
        permissions: permissions.map((p) => p.toJSON()),
    });
});

export default router;
