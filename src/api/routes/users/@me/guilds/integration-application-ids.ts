import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const rows: { guild_id: string; application_id: string }[] = await Member.createQueryBuilder("bot")
        .select("bot.guild_id", "guild_id")
        .addSelect("bot.id", "application_id")
        .innerJoin("bot.user", "user", "user.bot = true")
        .innerJoin(Member, "me", "me.guild_id = bot.guild_id AND me.id = :user_id", {
            user_id: req.user_id,
        })
        .getRawMany();

    const result: Record<string, string[]> = {};
    for (const { guild_id, application_id } of rows) (result[guild_id] ??= []).push(`${application_id}`);
    res.json(result);
});

export default router;
