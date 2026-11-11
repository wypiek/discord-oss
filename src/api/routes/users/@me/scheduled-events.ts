import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { GuildScheduledEventUser } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const raw = req.query.guild_ids;
    const guildIds = (Array.isArray(raw) ? raw : raw ? String(raw).split(",") : [])
        .map(String)
        .filter((id) => /^\d+$/.test(id))
        .slice(0, 200);
    if (!guildIds.length) return res.json([]);
    const rows = await GuildScheduledEventUser.find({
        where: { user_id: req.user_id, guild_id: In(guildIds) },
    });
    res.json(rows.map((row) => row.toJSON()));
});

export default router;
