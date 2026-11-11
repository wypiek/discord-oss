import { Request, Response, Router } from "express";
import { storage, setCacheControl, setCacheControlNotFound, fetchUpstreamAsset, sendAsset } from "../util";

const router = Router({ mergeParams: true });

router.get("/:file", setCacheControl, async (req: Request, res: Response) => {
    const file = req.params.file as string;
    if (!/^[0-9a-f]{32,64}(\.[a-z0-9]{2,6})?$/i.test(file)) return setCacheControlNotFound(req, res);
    const path = `content-assets/${file}`;
    const data = (await storage.get(path)) ?? (await fetchUpstreamAsset(path, `https://cdn.discordapp.com/assets/content/${file}`));
    if (!data) return setCacheControlNotFound(req, res);
    return sendAsset(res, data, file);
});

export default router;
