import crypto from "node:crypto";
import { Router, Response, Request } from "express";
import { fileTypeFromBuffer } from "file-type";
import { Config, isRequestSignature } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { storage, internalUpload, setCacheControl, setCacheControlNotFound, safeMediaType } from "../util";

export const SITE_IMAGE_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
};

export const SITE_IMAGE_FILE = /^[0-9a-f]{32}\.(png|jpg|webp|avif|gif)$/;

const router = Router({ mergeParams: true });

router.post(
    "/",
    internalUpload(async (req: Request, res: Response) => {
        if (!isRequestSignature(req.headers.signature)) throw new HTTPError("Invalid request signature");
        if (!req.file) throw new HTTPError("Missing file");
        const { buffer, size } = req.file;
        const type = await fileTypeFromBuffer(buffer);
        const extension = type && SITE_IMAGE_TYPES[type.mime];
        if (!type || !extension) throw new HTTPError("Invalid file type");
        const file = `${crypto.createHash("md5").update(buffer).digest("hex")}.${extension}`;
        await storage.set(`site-images/${file}`, buffer);
        return res.json({
            id: file,
            content_type: type.mime,
            size,
            url: `${(Config.get().cdn.endpointPublic || "").replace(/\/+$/, "")}${req.baseUrl}/${file}`,
        });
    }),
);

router.get("/:file", setCacheControl, async (req: Request, res: Response) => {
    const file = req.params.file as string;
    if (!SITE_IMAGE_FILE.test(file)) return setCacheControlNotFound(req, res);
    const data = await storage.get(`site-images/${file}`);
    if (!data) return setCacheControlNotFound(req, res);
    const type = await fileTypeFromBuffer(data);
    res.set("Content-Type", safeMediaType(type?.mime));
    return res.send(data);
});

export default router;
