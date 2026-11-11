import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const guildId = req.params.guild_id as string;
    if (!(await Member.exists({ where: { guild_id: guildId, id: req.user_id } }))) throw DiscordApiErrors.UNKNOWN_GUILD;
    const bots = await Member.find({
        where: { guild_id: guildId, user: { bot: true } },
        select: { id: true },
    });
    res.json(
        await buildCommandIndex(
            bots.map((m) => m.id),
            { guildId, context: 0, integrationType: 0, userId: req.user_id },
        ),
    );
});

export default router;
