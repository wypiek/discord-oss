import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { emitRemoteAuth } from "./index";
import { readHandshake } from "./finish";

const router = Router({ mergeParams: true });

router.post("/", route({ spacebarOnly: false }), async (req: Request, res: Response) => {
    await emitRemoteAuth(readHandshake(req), "REMOTE_AUTH_CANCEL");
    res.sendStatus(204);
});

export default router;
