import { Router, Response, Request } from "express";

const router = Router({ mergeParams: true });

router.get("/", (req: Request, res: Response) => {
    res.send("pong");
});

export default router;
