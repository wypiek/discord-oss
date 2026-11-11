import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { toPublicApplication } from "@spacebar/api/util/handlers/Application";
import { findWidgetApplications, toClientWidgetConfig } from "@spacebar/api/util/handlers/ApplicationWidgets";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const apps = await findWidgetApplications({ owner_id: req.user_id });
    res.json({
        applications: apps.map(toPublicApplication),
        configs: Object.fromEntries(apps.map((app) => [app.id, [toClientWidgetConfig(app, req.user_id)]])),
    });
});

export default router;
