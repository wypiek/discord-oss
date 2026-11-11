import bodyParser, { OptionsJson } from "body-parser";
import { NextFunction, Request, Response } from "express";
import { HTTPError } from "lambert-server/HTTPError";

const errorMessages: { [key: string]: [string, number] } = {
    "entity.too.large": ["Request body too large", 413],
    "entity.parse.failed": ["Invalid JSON body", 400],
    "entity.verify.failed": ["Entity verification failed", 403],
    "request.aborted": ["Request aborted", 400],
    "request.size.invalid": ["Request size did not match content length", 400],
    "stream.encoding.set": ["Stream encoding should not be set", 500],
    "stream.not.readable": ["Stream is not readable", 500],
    "parameters.too.many": ["Too many parameters", 413],
    "charset.unsupported": ["Unsupported charset", 415],
    "encoding.unsupported": ["Unsupported content encoding", 415],
};

let reservedBytes = 0;
const BODY_BUDGET_BYTES = 128 * 1024 * 1024;

function bodyReservation(limit: OptionsJson["limit"]) {
    if (typeof limit === "number") return limit * 2;
    const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit ?? "100kb");
    if (!match) throw new TypeError("Invalid JSON body limit");
    return Math.ceil(Number(match[1]) * ({ b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[match[2]?.toLowerCase() ?? "b"] ?? 1)) * 2;
}

export function BodyParser(opts?: OptionsJson) {
    const jsonParser = bodyParser.json(opts);
    const maximumReservation = bodyReservation(opts?.limit);

    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.headers["content-type"]) req.headers["content-type"] = "application/json";

        if (!req.is("application/json")) return jsonParser(req, res, next);
        if (req.readableEnded || (!req.headers["transfer-encoding"] && !req.headers["content-length"])) return jsonParser(req, res, next);
        const length = Number(req.headers["content-length"]);
        const uncompressed = !req.headers["content-encoding"] || req.headers["content-encoding"] === "identity";
        const reservation =
            uncompressed && Number.isSafeInteger(length) && length >= 0 && !req.headers["transfer-encoding"] ? Math.min(maximumReservation, length * 2) : maximumReservation;
        if (reservedBytes + reservation > BODY_BUDGET_BYTES) {
            res.setHeader("Connection", "close");
            res.once("finish", () => req.destroy());
            return res.status(503).json({ message: "Request body capacity exceeded" });
        }
        reservedBytes += reservation;
        let released = false;
        let expired = false;
        const release = () => {
            if (released) return;
            released = true;
            reservedBytes -= reservation;
            clearTimeout(deadline);
        };
        const deadline = setTimeout(() => {
            expired = true;
            release();
            res.setHeader("Connection", "close");
            res.once("finish", () => req.destroy());
            res.status(408).json({ message: "Request body deadline exceeded" });
        }, 15_000).unref();
        res.once("finish", release);
        res.once("close", release);
        req.once("aborted", release);

        jsonParser(req, res, (err) => {
            clearTimeout(deadline);
            if (expired) return;
            if (err) {
                const [message, status] = errorMessages[err.type] || ["Invalid Body", 400];
                const errorMessage = message.includes("charset") || message.includes("encoding") ? `${message} "${err.charset || err.encoding}"` : message;
                return next(new HTTPError(errorMessage, status));
            }
            next();
        });
    };
}
