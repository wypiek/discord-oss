import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Member } from "@spacebar/database";

const router = Router({ mergeParams: true });

router.post("/:read_state_type/:entity_id", route({ responses: { 204: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    await Member.IsInGuildOrFail(req.user_id, req.params.guild_id as string);
    res.sendStatus(204);
});

export default router;
