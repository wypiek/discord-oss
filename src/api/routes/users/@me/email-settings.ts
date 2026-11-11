import { Router, Response, Request } from "express";
import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";

const router = Router({ mergeParams: true });

const DEFAULT_CATEGORIES: Record<string, boolean> = {
    social: true,
    communication: true,
    tips: false,
    updates_and_announcements: false,
    recommendations_and_events: false,
    family_center_digest: false,
};

const load = (user_id: string) => User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });

const serialize = (user: User) => ({
    categories: { ...DEFAULT_CATEGORIES, ...user.account_preferences?.email_categories },
    initialized: !!user.account_preferences?.email_settings_initialized,
});

router.get("/", route({}), async (req: Request, res: Response) => {
    res.json(serialize(await load(req.user_id)));
});

router.patch("/", route({}), async (req: Request, res: Response) => {
    const { settings } = req.body as {
        settings?: { categories?: Record<string, unknown>; initialized?: unknown };
    };
    const user = await load(req.user_id);
    const email_categories = { ...user.account_preferences?.email_categories };
    for (const [category, enabled] of Object.entries(settings?.categories ?? {}))
        if (category in DEFAULT_CATEGORIES && typeof enabled === "boolean") email_categories[category] = enabled;
    user.account_preferences = {
        ...user.account_preferences,
        email_categories,
        email_settings_initialized: true,
    };
    await User.setAccountPreferences(req.user_id, { email_categories, email_settings_initialized: true });
    res.json(serialize(user));
});

export default router;
