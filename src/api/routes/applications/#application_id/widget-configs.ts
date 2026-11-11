import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { findWidgetApplications, toClientWidgetConfig } from "@spacebar/api/util/handlers/ApplicationWidgets";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const apps = await findWidgetApplications({ id: req.params.application_id as string }, 1);
    res.json(apps.map((app) => toClientWidgetConfig(app, req.user_id)));
});

export default router;
