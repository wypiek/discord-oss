import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { FieldErrors, emitEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const ACCOUNT_NOTIFICATION_FLAGS = 16 | 32;

const load = (user_id: string) => User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });

router.get("/", route({}), async (req: Request, res: Response) => {
    const user = await load(req.user_id);
    res.json({ flags: user.account_preferences?.notification_flags ?? 0 });
});

router.patch("/", route({}), async (req: Request, res: Response) => {
    const { flags } = req.body as { flags?: unknown };
    if (!Number.isInteger(flags) || (flags as number) < 0) throw FieldErrors({ flags: { code: "NUMBER_TYPE_COERCE", message: "Value is not a valid integer." } });
    const notification_flags = (flags as number) & ACCOUNT_NOTIFICATION_FLAGS;
    await User.setAccountPreferences(req.user_id, { notification_flags });
    await emitEvent({ event: "NOTIFICATION_SETTINGS_UPDATE", data: { flags: notification_flags }, user_id: req.user_id });
    res.json({ flags: notification_flags });
});

export default router;
