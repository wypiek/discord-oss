import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { ApplicationIdentity } from "@spacebar/database";
import { toPublicApplication } from "@spacebar/api/util/handlers/Application";
import { findWidgetApplications, toClientWidgetConfig } from "@spacebar/api/util/handlers/ApplicationWidgets";

const router = Router({ mergeParams: true });

// The widgets offered in the client's Add Widget picker: your own, the ones apps have data for you in, and public ones.
router.get("/", route({ responses: { 200: {} } }), async (req: Request, res: Response) => {
    const linked = (
        await ApplicationIdentity.find({
            where: { user_id: req.user_id },
            select: { application_id: true },
        })
    ).map((x) => x.application_id);
    const apps = await findWidgetApplications([{ owner_id: req.user_id }, { widget_public: true }, ...(linked.length ? [{ id: In(linked) }] : [])]);
    res.json({
        applications: apps.map(toPublicApplication),
        configs: Object.fromEntries(apps.map((app) => [app.id, [toClientWidgetConfig(app, req.user_id)]])),
    });
});

export default router;
