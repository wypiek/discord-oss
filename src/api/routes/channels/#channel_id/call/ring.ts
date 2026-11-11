import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { PrivateCalls } from "@spacebar/database";
import { assertRecipient, ringRecipients } from "./index";

const router: Router = Router({ mergeParams: true });

router.post("/", route({ responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    await assertRecipient(req);
    const recipients = ringRecipients(req);
    await PrivateCalls.ring(req.params.channel_id as string, req.user_id, recipients);
    res.sendStatus(204);
});

export default router;
