import { NextFunction, Request, Response } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { ApiError, FieldError, FieldErrors } from "@spacebar/util";
import { StringLengthOutOfBoundsException } from "@spacebar/extensions";
const EntityNotFoundErrorRegex = /"(\w+)"/;

export function ErrorHandler(error: Error & { type?: string }, req: Request, res: Response, next: NextFunction) {
    if (!error) return next();

    // Convert custom generic exception classes to spacebar errors
    if (error instanceof StringLengthOutOfBoundsException)
        error = FieldErrors({
            [error.key]: {
                code: "BASE_TYPE_BAD_LENGTH",
                message: req.t("common:field.BASE_TYPE_BAD_LENGTH", {
                    length: `${error.min} - ${error.max}`,
                }),
            },
        });

    try {
        let code = 400;
        let httpcode = code;
        let message = error?.toString();
        let errors = undefined;
        let _ajvErrors = undefined;

        if (process.env.LOG_API_ERRORS === "true") console.error("[ErrorHandler] Uncaught exception:", error);

        if (error instanceof HTTPError && error.code) {
            code = httpcode = error.code;
            message = error.message;
        } else if (error instanceof ApiError) {
            code = error.code;
            message = error.message;
            httpcode = error.httpStatus;
        } else if (error.name === "EntityNotFoundError") {
            message = `${error.message.match(EntityNotFoundErrorRegex)?.[1] || "Item"} could not be found`;
            code = httpcode = 404;
        } else if (error instanceof FieldError) {
            code = Number(error.code);
            message = error.message;
            errors = error.errors;
            _ajvErrors = error._ajvErrors;
        } else if (error?.type == "entity.parse.failed") {
            // body-parser failed
            httpcode = 400;
            code = 50109;
            message = "The request body contains invalid JSON.";
        } else {
            console.error(`[Error] ${code} ${req.url}\n`, errors ?? error, "\nbody:", req.body);
            message = "500: Internal Server Error";
            code = 0;
            httpcode = 500;
        }

        if (httpcode > 511) httpcode = 400;

        res.status(httpcode).json({ code, message, errors, _ajvErrors, request: `${req.method} ${req.url}` });
    } catch (error) {
        console.error(`[Internal Server Error] 500`, error);
        return res.status(500).json({ code: 0, message: "500: Internal Server Error" });
    }
}
