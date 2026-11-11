import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ApplicationAuthorization } from "@spacebar/database";
import { buildCommandIndex } from "@spacebar/api/util/handlers/ApplicationCommands";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const authorizations = await ApplicationAuthorization.find({
        where: { user_id: req.user_id, integration_type: 1 },
        select: { application_id: true },
    });
    res.json(
        await buildCommandIndex(
            authorizations.map((a) => a.application_id),
            { integrationType: 1 },
        ),
    );
});

export default router;
