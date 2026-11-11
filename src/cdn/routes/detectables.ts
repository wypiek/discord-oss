import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get(["/games-v1.json", "/non-games-v1.json"], (req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=86400").json([]);
});

export default router;
