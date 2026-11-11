import multerConfig from "multer";
import { Request, Response, RequestHandler } from "express";
import { isRequestSignature } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { bufferedUpload, internalUploadBufferLimit, internalUploadBufferOverhead } from "./uploadAdmission";

export const multer = multerConfig({
    storage: multerConfig.memoryStorage(),
    limits: {
        fields: 10,
        files: 10,
        fileSize: 1024 * 1024 * 100,
    },
});

export function internalUpload(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
    const upload = bufferedUpload(internalUploadBufferLimit, multer.single("file"), handler, internalUploadBufferOverhead);
    return (req, res, next) => {
        if (!isRequestSignature(req.headers.signature)) return next(new HTTPError("Invalid request signature", 403));
        return upload(req, res, next);
    };
}
