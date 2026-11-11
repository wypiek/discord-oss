import { route } from "@spacebar/api/middlewares";
import { ResponseError, createHarvest, getHarvest } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({ responses: { 200: {}, 204: {} } }), async (req: Request, res: Response) => {
    const harvest = await getHarvest(req.user_id);
    if (!harvest) return res.sendStatus(204);
    res.json(harvest);
});

router.post("/", route({ responses: { 200: {}, 400: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const harvest = await createHarvest(req.user_id, (req.body as { backends?: unknown })?.backends);
    if (!harvest)
        throw new ResponseError(400, {
            message: "You already have a pending data package request.",
            code: 0,
        });
    res.json(harvest);
});

export default router;
