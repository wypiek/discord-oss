import { route } from "@spacebar/api/middlewares";
import { listUserIdentities } from "@spacebar/api/util/handlers/ApplicationWidgets";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const userId = req.params.user_id === "@me" ? req.user_id : (req.params.user_id as string);
    res.json({ identities: await listUserIdentities(userId, req.user_id) });
});

export default router;
