import { Request, Response, RequestHandler } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import process from "node:process";

const DEFAULT_BYTE_BUDGET = 1024 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 16;
export const CLOUD_UPLOAD_OVERHEAD = 64 * 1024;
export const INTERNAL_UPLOAD_OVERHEAD = 64 * 1024 * 1024;
export const INTERNAL_UPLOAD_FILE_LIMIT = 100 * 1024 * 1024;

type UploadCapacity = { bytes: number; concurrent: number };

export class UploadAdmissionError extends HTTPError {
    constructor(
        message: string,
        code: number,
        readonly retryable = false,
    ) {
        super(message, code);
    }
}

function configuredInteger(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
    const value = process.env[name];
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum)
        throw new UploadAdmissionError("Upload buffering configuration is invalid", 503);
    return Number(value);
}

function internalContentLength(req: Request): number | undefined {
    const value = req.headers["content-length"];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new UploadAdmissionError("Invalid upload Content-Length", 400);
    const length = Number(value);
    if (length > INTERNAL_UPLOAD_FILE_LIMIT + INTERNAL_UPLOAD_OVERHEAD) throw new UploadAdmissionError("Upload body exceeds allowed multipart size", 413);
    return length;
}

export const internalUploadBufferLimit = (req: Request) => Math.min(INTERNAL_UPLOAD_FILE_LIMIT, internalContentLength(req) ?? INTERNAL_UPLOAD_FILE_LIMIT);

export const internalUploadBufferOverhead = (req: Request) => {
    const length = internalContentLength(req);
    return length === undefined ? INTERNAL_UPLOAD_OVERHEAD : Math.min(INTERNAL_UPLOAD_OVERHEAD, length * 4 + CLOUD_UPLOAD_OVERHEAD);
};

export class UploadAdmission {
    private active = 0;
    private reserved = 0;

    constructor(private readonly capacity: () => UploadCapacity) {}

    reserve(fileBytes: number, overhead: number): () => void {
        const { bytes, concurrent } = this.capacity();
        if (!Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(concurrent) || concurrent < 1 || concurrent > 64)
            throw new UploadAdmissionError("Upload buffering configuration is invalid", 503);
        const weight = fileBytes * 2 + overhead;
        if (!Number.isSafeInteger(fileBytes) || fileBytes < 0 || !Number.isSafeInteger(overhead) || overhead < 0 || !Number.isSafeInteger(weight) || weight > bytes)
            throw new UploadAdmissionError("Upload exceeds this server's buffering capacity", 413);
        if (this.active >= concurrent || weight > bytes - this.reserved) throw new UploadAdmissionError("Upload buffering capacity is busy; retry shortly", 503, true);
        this.active++;
        this.reserved += weight;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active--;
            this.reserved -= weight;
        };
    }
}

export const attachmentUploadAdmission = new UploadAdmission(() => ({
    bytes: configuredInteger("CDN_UPLOAD_BUFFER_BUDGET_BYTES", DEFAULT_BYTE_BUDGET),
    concurrent: configuredInteger("CDN_UPLOAD_MAX_CONCURRENT", DEFAULT_CONCURRENCY, 64),
}));

export function bufferedUpload(
    limit: (req: Request, res: Response) => number,
    parser: RequestHandler,
    handler: (req: Request, res: Response) => Promise<unknown>,
    overhead: number | ((req: Request, res: Response) => number) = CLOUD_UPLOAD_OVERHEAD,
    admission = attachmentUploadAdmission,
): RequestHandler {
    return async (req, res, next) => {
        let release: (() => void) | undefined;
        let failed = false;
        let failure: unknown;
        try {
            release = admission.reserve(limit(req, res), typeof overhead === "function" ? overhead(req, res) : overhead);
            await new Promise<void>((resolve, reject) => {
                parser(req, res, (error) => (error ? reject(error) : resolve()));
            });
            if ((req.destroyed && !req.complete) || res.destroyed) throw new HTTPError("Upload request was aborted", 400);
            await handler(req, res);
        } catch (error) {
            failed = true;
            failure = error;
        } finally {
            if (req.file) delete (req.file as Partial<Express.Multer.File>).buffer;
            req.body = undefined;
            release?.();
        }
        if (failed) {
            if (failure instanceof UploadAdmissionError && failure.retryable) res.set("Retry-After", "1");
            next(failure);
        }
    };
}
