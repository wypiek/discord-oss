import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { findPublicApplications } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const raw = req.query.application_ids;
    const ids = (Array.isArray(raw) ? raw : [raw])
        .flatMap((x) => String(x ?? "").split(","))
        .filter((id) => /^\d{1,20}$/.test(id))
        .slice(0, 100);
    res.json(await findPublicApplications(ids));
});

export default router;
