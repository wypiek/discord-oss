import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Application } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const application = await Application.findOne({
        where: { id: req.params.application_id as string },
    });
    if (!application) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    res.json(await buildCommandIndex([application.id], {}));
});

export default router;
