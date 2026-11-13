import { NextFunction, Request, Response } from "express";
import { dataUriLength, FieldErrors, imageTooLargeMessage, MAX_IMAGE_UPLOAD_BYTES, oversizedDataUris } from "@spacebar/util";

export const DEFAULT_JSON_BODY_BYTES = 10 * 1024 * 1024;
const JSON_ENVELOPE_BYTES = 1024 * 1024;

type ImageRoute = { methods: string[]; path: RegExp; images: number };

const ID = String.raw`(?:\d+|@me)`;
const IMAGE_ROUTES: ImageRoute[] = [
    { methods: ["POST"], path: /^\/guilds$/, images: 1 },
    { methods: ["PATCH"], path: /^\/guilds\/\d+$/, images: 4 },
    { methods: ["PATCH"], path: /^\/guilds\/\d+\/profile$/, images: 2 },
    { methods: ["PATCH"], path: new RegExp(String.raw`^\/guilds\/\d+\/(?:profile|members)\/${ID}$`), images: 2 },
    { methods: ["POST", "PATCH"], path: /^\/guilds\/\d+\/(?:roles|scheduled-events|soundboard-sounds)(?:\/\d+)?$/, images: 1 },
    { methods: ["POST"], path: /^\/(?:guilds|applications)\/\d+\/emojis$/, images: 1 },
    { methods: ["PATCH"], path: /^\/users\/@me$/, images: 2 },
    { methods: ["PATCH"], path: /^\/users\/@me\/profile$/, images: 1 },
    { methods: ["PATCH"], path: /^\/channels\/\d+$/, images: 1 },
    { methods: ["POST"], path: /^\/channels\/\d+\/webhooks$/, images: 1 },
    { methods: ["PATCH"], path: /^\/webhooks\/\d+(?:\/[\w-]+)?$/, images: 1 },
    { methods: ["PATCH"], path: new RegExp(String.raw`^\/applications\/${ID}$`), images: 2 },
    { methods: ["PATCH"], path: /^\/applications\/\d+\/bot$/, images: 1 },
    { methods: ["POST", "PATCH", "PUT"], path: /^\/applications\/\d+\/widget-config$/, images: 4 },
    { methods: ["POST"], path: /^\/oauth2\/applications\/\d+\/assets$/, images: 1 },
    { methods: ["POST", "PATCH", "PUT"], path: /^\/admin(?:\/|$)/, images: 4 },
];

export const apiRoutePath = (path: string) =>
    path
        .replace(/%40/gi, "@")
        .replace(/^\/api(?:\/v\d+)?(?=\/|$)/, "")
        .replace(/\/+$/, "") || "/";

export function imageUploadCount(method: string, path: string) {
    if (!/^\/api(?:\/|$)/.test(path)) return 0;
    const route = apiRoutePath(path);
    return IMAGE_ROUTES.find((entry) => entry.methods.includes(method.toUpperCase()) && entry.path.test(route))?.images ?? 0;
}

export function jsonBodyLimit(method: string, path: string) {
    const images = imageUploadCount(method, path);
    return images ? Math.max(DEFAULT_JSON_BODY_BYTES, images * dataUriLength(MAX_IMAGE_UPLOAD_BYTES) + JSON_ENVELOPE_BYTES) : DEFAULT_JSON_BODY_BYTES;
}

export function ImageUploadLimit(req: Request, _res: Response, next: NextFunction) {
    if (!req.body || typeof req.body !== "object" || !imageUploadCount(req.method, req.path)) return next();
    const fields = oversizedDataUris(req.body);
    if (!fields.length) return next();
    const message = imageTooLargeMessage();
    return next(FieldErrors(Object.fromEntries(fields.map((field) => [field, { code: "BINARY_TYPE_MAX_SIZE", message }]))));
}
