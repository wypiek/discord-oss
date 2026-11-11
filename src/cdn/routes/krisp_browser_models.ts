import { Request, Response, Router } from "express";
import { storage, setCacheControl, setCacheControlNotFound, fetchUpstreamAsset, sendAsset } from "../util";

const router = Router({ mergeParams: true });

router.get("/:version/:file", setCacheControl, async (req: Request, res: Response) => {
    const { version, file } = req.params as { [key: string]: string };
    if (!/^v[\w.-]{1,32}$/.test(version) || !/^[\w-]{1,64}\.kw$/.test(file)) return setCacheControlNotFound(req, res);
    const path = `krisp_browser_models/${version}/${file}`;
    const data = (await storage.get(path)) ?? (await fetchUpstreamAsset(path, `https://cdn.discordapp.com/assets/${path}`));
    if (!data) return setCacheControlNotFound(req, res);
    return sendAsset(res, data, file);
});

export default router;
