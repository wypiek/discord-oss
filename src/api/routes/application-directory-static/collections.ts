import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { listDirectoryApplications } from "@spacebar/api/util/handlers/Application";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (_req: Request, res: Response) => {
    const { applications } = await listDirectoryApplications("", 0, 24);
    if (!applications.length) return res.json([]);
    res.json([
        {
            id: "1",
            type: 1,
            position: 0,
            platforms: 0,
            active_state: 1,
            flags: 0,
            title: "Apps on this instance",
            description: "",
            application_directory_collection_items: applications.map((application, position) => ({
                id: application.id,
                type: 1,
                position,
                flags: 0,
                image_hash: null,
                application,
            })),
        },
    ]);
});

export default router;
