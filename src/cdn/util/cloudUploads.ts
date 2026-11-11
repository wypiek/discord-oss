import { NextFunction, Request, Response } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { CloudAttachment } from "@spacebar/database";
import { Config, isRequestSignature } from "@spacebar/util";

export function requireInternalUploadSignature(req: Request, _res: Response, next: NextFunction) {
    if (!isRequestSignature(req.headers.signature)) return next(new HTTPError("Invalid request signature", 403));
    return next();
}

export function declaredCloudUploadLimit(attachment: CloudAttachment): number {
    const configured = Config.get().cdn.maxAttachmentSize;
    const declared = attachment.userFileSize;
    if (!Number.isSafeInteger(configured) || configured < 1) throw new HTTPError("Uploads are unavailable", 503);
    if (typeof declared !== "number" || !Number.isSafeInteger(declared) || declared < 0 || declared > configured) throw new HTTPError("Invalid upload reservation", 400);
    return declared;
}

export async function requireCloudUploadReservation(req: Request, res: Response, next: NextFunction) {
    try {
        const { channel_id, batch_id, attachment_id, filename } = req.params as Record<string, string>;
        const attachment = await CloudAttachment.findOne({
            where: {
                uploadFilename: `${channel_id}/${batch_id}/${attachment_id}/${filename}`,
                channelId: channel_id,
                userAttachmentId: attachment_id,
                userFilename: filename,
            },
        });
        if (!attachment || !attachment.userId) throw new HTTPError("Attachment not found", 404);
        const limit = declaredCloudUploadLimit(attachment);
        const contentLength = req.headers["content-length"];
        if (contentLength !== undefined) {
            const length = Number(contentLength);
            const overhead = req.is("multipart/form-data") ? 16 * 1024 : 0;
            if (!Number.isSafeInteger(length) || length < 0 || length > limit + overhead) throw new HTTPError("File too large", 413);
        }
        res.locals.cloudAttachment = attachment;
        return next();
    } catch (error) {
        return next(error);
    }
}
