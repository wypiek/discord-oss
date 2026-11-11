import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { ProcessLifecycle } from "@spacebar/util/util/ProcessLifecycle";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "OPERATOR",
        responses: {
            200: {},
            403: {
                body: "APIErrorResponse",
            },
        },
    }),
    (req: Request, res: Response) => {
        console.log(`/stop was called by ${req.user_id} at ${new Date()}`);
        res.sendStatus(200);
        ProcessLifecycle.Shutdown().catch((e) => {
            console.error("Failed to shut down:", e);
        });
    },
);

export default router;
