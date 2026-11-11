import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Recipient } from "@spacebar/database";
import { Config, DiscordApiErrors, FieldErrors } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

export const assertRecipient = async (req: Request) => {
    if (
        !(await Recipient.exists({
            where: { channel_id: req.params.channel_id as string, user_id: req.user_id },
        }))
    )
        throw DiscordApiErrors.UNKNOWN_CHANNEL;
};

export const ringRecipients = (req: Request) => {
    const recipients = req.body?.recipients;
    if (!Array.isArray(recipients)) return null;
    const limit = Config.get().limits.channel.maxGroupDmRecipients;
    if (recipients.length > limit) throw FieldErrors({ recipients: { code: "BASE_TYPE_BAD_LENGTH", message: `Must be ${limit} or fewer in length.` } });
    return [...new Set(recipients.map(String))];
};

router.get("/", route({ responses: { 200: {}, 404: {} } }), async (req: Request, res: Response) => {
    await assertRecipient(req);
    res.json({ ringable: true });
});

router.patch("/", route({ responses: { 204: {}, 404: {} } }), async (req: Request, res: Response) => {
    await assertRecipient(req);
    res.sendStatus(204);
});

export default router;
