import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { DiscordApiErrors } from "@spacebar/util";
import { findPublicApplications } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const [app] = await findPublicApplications([req.params.application_id as string]);
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    res.json(app);
});

export default router;
