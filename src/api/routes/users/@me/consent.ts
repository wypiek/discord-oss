import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

const CONSENT_TYPES = ["usage_statistics", "personalization"];

const serialize = (consents: Record<string, boolean> = {}) => Object.fromEntries(CONSENT_TYPES.map((type) => [type, { consented: !!consents[type] }]));

const load = (user_id: string) => User.findOneOrFail({ where: { id: user_id }, select: { id: true, account_preferences: true } });

router.get("/", route({}), async (req: Request, res: Response) => {
    const user = await load(req.user_id);
    res.json(serialize(user.account_preferences?.consents));
});

router.post("/", route({}), async (req: Request, res: Response) => {
    const { grant, revoke } = req.body as { grant?: unknown; revoke?: unknown };
    const user = await load(req.user_id);
    const consents = { ...user.account_preferences?.consents };
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((x): x is string => CONSENT_TYPES.includes(x)) : []);
    for (const type of list(grant)) consents[type] = true;
    for (const type of list(revoke)) consents[type] = false;
    await User.setAccountPreferences(req.user_id, { consents });
    res.json(serialize(consents));
});

export default router;
