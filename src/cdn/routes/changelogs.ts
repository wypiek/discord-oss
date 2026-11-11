import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/config_:platform.json", (req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=3600").json({});
});

export default router;
