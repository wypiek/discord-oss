import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Application } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { isDirectoryApplication, toDirectoryApplication } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const app = await Application.findOne({
        where: { id: req.params.application_id as string },
        relations: { bot: true },
    });
    if (!app || !(await isDirectoryApplication(app))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    res.json(await toDirectoryApplication(app));
});

export default router;
