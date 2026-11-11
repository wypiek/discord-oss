import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { HTTPError } from "lambert-server/HTTPError";
import { Config } from "@spacebar/util";

export const MAX_UPLOAD_REQUEST_BYTES = 100 * 1024 * 1024;

export function boundedMemoryStorage(totalBytes = MAX_UPLOAD_REQUEST_BYTES): multer.StorageEngine {
    const uploadBytes = new WeakMap<Request, number>();
    return {
        _handleFile(req, file, callback) {
            let chunks: Buffer[] = [];
            let size = 0;
            let failed = false;
            const fail = (error: Error) => {
                if (failed) return;
                failed = true;
                chunks = [];
                callback(error);
            };
            file.stream.on("data", (chunk: Buffer) => {
                if (failed) return;
                const total = (uploadBytes.get(req) ?? 0) + chunk.length;
                uploadBytes.set(req, total);
                if (total > totalBytes) return fail(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname));
                size += chunk.length;
                chunks.push(chunk);
            });
            file.stream.on("error", fail);
            file.stream.on("limit", () => fail(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname)));
            file.stream.on("end", () => {
                if (!failed) callback(null, { buffer: Buffer.concat(chunks), size });
            });
        },
        _removeFile(_req, file, callback) {
            delete (file as Partial<Express.Multer.File>).buffer;
            callback(null);
        },
    };
}

export function boundedMessageUpload(storage = boundedMemoryStorage()) {
    return (req: Request, res: Response, next: NextFunction) => {
        const { maxAttachmentSize, maxAttachments } = Config.get().limits.message;
        return multer({
            limits: {
                fileSize: Math.min(maxAttachmentSize, 25 * 1024 * 1024),
                files: Math.min(maxAttachments, 10),
                fields: 10,
                parts: 20,
                fieldSize: 1024 * 1024,
            },
            storage,
        }).any()(req, res, (error) => next(error instanceof multer.MulterError ? new HTTPError(error.message, 413) : error));
    };
}
