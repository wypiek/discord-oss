import { route } from "@spacebar/api/middlewares";
import { User } from "@spacebar/database";
import { validateProfileWidgetSelection } from "@spacebar/api/util/handlers/ProfileWidgetSelection";
import { Request, Response, Router } from "express";

const router: Router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const user = await User.findOneOrFail({
        where: { id: req.user_id },
        select: { id: true, profile_widgets: true },
    });
    res.json({ widgets: user.profile_widgets ?? [] });
});

router.put("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const next = await validateProfileWidgetSelection(req.user_id, req.body?.widgets);
    await User.update({ id: req.user_id }, { profile_widgets: next });
    res.json({ widgets: next });
});

export default router;
