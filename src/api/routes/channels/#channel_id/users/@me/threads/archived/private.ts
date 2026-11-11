import { Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { listArchivedThreads } from "../../../../threads";

const router = Router({ mergeParams: true });

router.get("/", route({ permission: "VIEW_CHANNEL", responses: { 200: {}, 403: {} } }), listArchivedThreads("joined"));

export default router;
