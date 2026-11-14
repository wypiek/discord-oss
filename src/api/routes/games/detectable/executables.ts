import { route } from "@spacebar/api/middlewares";
import { DetectableGames, type ExecutablePlatform } from "@spacebar/api/util";
import { Request, Response, Router } from "express";

const PLATFORMS: ExecutablePlatform[] = ["darwin", "win32", "linux"];

const router: Router = Router({ mergeParams: true });

router.get("/", route({ authentication: "never", responses: { 200: {}, 304: {} } }), async (req: Request, res: Response) => {
    const platform = PLATFORMS.find((x) => x === req.query.os);
    if (!platform) return res.status(400).json({ code: 50035, message: "os must be darwin, win32 or linux" });
    const list = await DetectableGames.executables(platform);
    res.set({ "Cache-Control": "public, max-age=3600", ETag: list.etag, Vary: "Accept-Encoding" });
    if (req.headers["if-none-match"] === list.etag) return res.status(304).end();
    const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    res.type("application/json");
    if (gzip) res.set("Content-Encoding", "gzip");
    res.send(gzip ? list.gzip : list.body);
});

export default router;
