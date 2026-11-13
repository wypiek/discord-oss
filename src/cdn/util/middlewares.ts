import { NextFunction, Response, Request } from "express";
import { isRequestSignature } from "@spacebar/util";
import { HTTPError } from "lambert-server";

export function setCacheControl(req: Request, res: Response, next: NextFunction) {
    const cacheDuration = 21600; // 6 hours
    res.setHeader("Cache-Control", `public, max-age=${cacheDuration}, s-maxage=${cacheDuration}, immutable`);
    next();
}

export const NOT_FOUND_CACHE_CONTROL = "no-store";

export function setCacheControlNotFound(req: Request, res: Response) {
    res.setHeader("Cache-Control", NOT_FOUND_CACHE_CONTROL);
    res.status(404).send(`${req.path.slice(0, 256)} not found`);
}

export function validateServerAuth(req: Request, res: Response, next: NextFunction) {
    if (!isRequestSignature(req.headers.signature)) throw new HTTPError("Invalid request signature");
    next();
}
