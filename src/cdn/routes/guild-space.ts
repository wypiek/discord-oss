import { Router, Response, Request } from "express";
import { fileTypeFromBuffer } from "file-type";
import { HTTPError } from "lambert-server/HTTPError";
import { Config, isRequestSignature } from "@spacebar/util";
import { storage, internalUpload, setCacheControl, setCacheControlNotFound } from "../util";
import { imageHash, sendImage } from "../util/imageVariants";

const ANIMATED_MIME_TYPES = ["image/apng", "image/gif", "image/gifv"];
const ALLOWED_MIME_TYPES = [...ANIMATED_MIME_TYPES, "image/png", "image/jpeg", "image/webp", "image/avif"];
const SNOWFLAKE = /^\d{1,19}$/;

const router = Router({ mergeParams: true });

const storeImage = (folder: (params: Record<string, string>) => string) =>
    internalUpload(async (req: Request, res: Response) => {
        if (!isRequestSignature(req.headers.signature)) throw new HTTPError("Invalid request signature");
        if (!req.file) throw new HTTPError("Missing file");
        const params = req.params as Record<string, string>;
        if (!Object.values(params).every((value) => SNOWFLAKE.test(value))) throw new HTTPError("Invalid path");
        const { buffer, size } = req.file;

        const type = await fileTypeFromBuffer(buffer);
        if (!type || !ALLOWED_MIME_TYPES.includes(type.mime)) throw new HTTPError("Invalid file type");
        const hash = imageHash(buffer, type.mime);
        const path = `${folder(params)}/${hash}`;

        await storage.set(path, buffer);

        return res.json({
            id: hash,
            content_type: type.mime,
            size,
            url: `${Config.get().cdn.endpointPublic}/${path}`,
        });
    });

const serveImage = (folder: (params: Record<string, string>) => string) => async (req: Request, res: Response) => {
    const params = req.params as Record<string, string>;
    const path = `${folder(params)}/${params.hash.split(".")[0]}`;
    const file = await storage.get(path);
    if (!file) return setCacheControlNotFound(req, res);
    return sendImage(req, res, path, file);
};

const deleteImage = (folder: (params: Record<string, string>) => string) => async (req: Request, res: Response) => {
    if (!isRequestSignature(req.headers.signature)) throw new HTTPError("Invalid request signature");
    const params = req.params as Record<string, string>;
    await storage.delete(`${folder(params)}/${params.hash}`);
    return res.send({ success: true });
};

const bannerFolder = ({ guild_id }: Record<string, string>) => `guild-space/${guild_id}/banner`;
const widgetFolder = ({ guild_id, widget_id }: Record<string, string>) => `guild-space/${guild_id}/image-text-widget/${widget_id}`;

router.post("/:guild_id/banner", storeImage(bannerFolder));
router.get("/:guild_id/banner/:hash", setCacheControl, serveImage(bannerFolder));
router.delete("/:guild_id/banner/:hash", deleteImage(bannerFolder));

router.post("/:guild_id/image-text-widget/:widget_id", storeImage(widgetFolder));
router.get("/:guild_id/image-text-widget/:widget_id/:hash", setCacheControl, serveImage(widgetFolder));
router.delete("/:guild_id/image-text-widget/:widget_id/:hash", deleteImage(widgetFolder));

export default router;
