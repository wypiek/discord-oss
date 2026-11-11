import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { PrivateCalls } from "@spacebar/database";
import { assertRecipient, ringRecipients } from "./index";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    await assertRecipient(req);
    const recipients = ringRecipients(req) ?? [req.user_id];
    await PrivateCalls.stopRinging(req.params.channel_id as string, recipients);
    res.sendStatus(204);
});

export default router;
