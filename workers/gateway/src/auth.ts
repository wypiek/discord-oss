import { timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

export const authorized = (request: Request, secret?: string) => {
    if (!secret) return false;
    const given = encoder.encode(request.headers.get("x-event-secret") ?? "");
    const expected = encoder.encode(secret);
    return given.byteLength === expected.byteLength && timingSafeEqual(given, expected);
};
