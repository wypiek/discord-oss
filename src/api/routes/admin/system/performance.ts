import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { getDatabase } from "@spacebar/database";
import { Monitoring } from "../../../../util/monitoring/Monitoring";

const router = Router({ mergeParams: true });
router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "Process memory, event loop delay and HTTP route timings since startup",
    }),
    async (req: Request, res: Response) => {
        const started = performance.now();
        const database = await getDatabase()
            ?.query("SELECT 1")
            .then(
                () => ({ connected: true, round_trip_ms: performance.now() - started }),
                () => ({ connected: false, round_trip_ms: performance.now() - started }),
            );
        res.set("Cache-Control", "no-store").json({
            ...(await Monitoring.snapshot()),
            database: database ?? { connected: false, round_trip_ms: null },
        });
    },
);
export default router;
