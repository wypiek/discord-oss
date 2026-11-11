import { NextFunction, Request, Response } from "express";
import { FieldErrors } from "@spacebar/util";
import { readPayloadJson } from "../util/handlers/FieldCaps";

export function parsePayloadJson(req: Request, _res: Response, next: NextFunction) {
    const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : Object.values(req.files ?? {}).flat();
    const { body, errors } = readPayloadJson(req.body, files);
    if (errors) throw FieldErrors(errors);
    req.body = body;
    next();
}
