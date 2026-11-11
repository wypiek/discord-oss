import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { findWidgetApplications } from "@spacebar/api/util/handlers/ApplicationWidgets";
import { DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

// Widget data is pushed by the application and read on every profile fetch, so there's nothing to refresh.
router.post("/", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const [app] = await findWidgetApplications({ id: req.params.application_id as string }, 1);
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    res.sendStatus(204);
});

export default router;
