import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Application } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    if (!(await Application.exists({ where: { id: req.params.application_id as string } }))) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    res.json({ disclosures: [], acked_disclosures: [], all_acked: true });
});

router.post("/", route({}), async (_req: Request, res: Response) => {
    res.sendStatus(204);
});

export default router;
