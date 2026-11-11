import { FieldErrors } from "./FieldError";

export const UserFieldCaps = {
    username: 32,
    globalName: 32,
    nick: 32,
    customStatusText: 128,
    customStatusEmojiName: 32,
    clientInfo: 128,
    memberQuery: 100,
    memberRequestNonce: 32,
    memberRequestUserIds: 100,
    guildSettingsBulk: 1000,
    widgetText: 256,
    widgetItems: 50,
} as const;

export function textLength(value: string) {
    return Array.from(value).length;
}

export function clampText(value: unknown, max: number) {
    if (typeof value !== "string") return undefined;
    if (value.length <= max) return value;
    return Array.from(value).slice(0, max).join("");
}

export function exceedsLength(value: unknown, max: number) {
    return typeof value === "string" && value.length > max && textLength(value) > max;
}

export function assertMaxLength(field: string, value: unknown, max: number) {
    if (!exceedsLength(value, max)) return;
    throw FieldErrors({ [field]: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${max} or fewer in length.` } });
}

export function findOversizedField(value: unknown, maxText: number, maxItems: number, path = "", depth = 0): string | null {
    if (typeof value === "string") return exceedsLength(value, maxText) ? path : null;
    if (!value || typeof value !== "object") return null;
    if (depth > 8) return path;
    const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    if (entries.length > maxItems) return path;
    for (const [key, item] of entries) {
        if (exceedsLength(key, maxText)) return path;
        const found = findOversizedField(item, maxText, maxItems, path ? `${path}.${key}` : key, depth + 1);
        if (found !== null) return found;
    }
    return null;
}
