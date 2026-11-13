export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const DATA_URI_HEADER_BYTES = 128;
const NESTED_DEPTH = 2;

export const imageTooLargeMessage = (maxBytes = MAX_IMAGE_UPLOAD_BYTES) => `File cannot be larger than ${(maxBytes / 1024).toFixed(1)} kb.`;

export const dataUriLength = (bytes: number) => Math.ceil(bytes / 3) * 4 + DATA_URI_HEADER_BYTES;

export function dataUriPayloadBytes(value: unknown) {
    if (typeof value !== "string" || !value.startsWith("data:")) return 0;
    const comma = value.indexOf(",");
    if (comma < 0) return 0;
    const payload = value.length - comma - 1;
    if (!/;base64$/i.test(value.slice(0, comma))) return payload;
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((payload * 3) / 4) - padding);
}

export function oversizedDataUris(body: unknown, maxBytes = MAX_IMAGE_UPLOAD_BYTES, path = "", depth = 0): string[] {
    if (dataUriPayloadBytes(body) > maxBytes) return [path];
    if (!body || typeof body !== "object" || depth > NESTED_DEPTH) return [];
    return Object.entries(body).flatMap(([key, value]) => oversizedDataUris(value, maxBytes, path ? `${path}.${key}` : key, depth + 1));
}
