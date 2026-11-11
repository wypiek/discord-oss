import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { topSoundboardSounds } from "@spacebar/api/util";
import { Member } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    await Member.IsInGuildOrFail(req.user_id, guild_id);
    res.json({ items: topSoundboardSounds(guild_id) });
});

export default router;
