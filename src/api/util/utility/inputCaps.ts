import { FieldErrors } from "@spacebar/util/util/FieldError";

export const tooLong = (field: string, max: number) => FieldErrors({ [field]: { code: "BASE_TYPE_BAD_LENGTH", message: `Must be ${max} or fewer in length.` } });

export function assertMaxLength(field: string, value: unknown, max: number, maxItems = 1) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length > maxItems) throw FieldErrors({ [field]: { code: "BASE_TYPE_BAD_LENGTH", message: `Must have ${maxItems} or fewer values.` } });
    if (values.some((entry) => typeof entry === "string" && entry.length > max)) throw tooLong(field, max);
}

export function assertMaxLengths(source: unknown, limits: Record<string, number>) {
    if (!source || typeof source !== "object") return;
    for (const [field, max] of Object.entries(limits)) assertMaxLength(field, (source as Record<string, unknown>)[field], max);
}

export const GIF_QUERY_LIMITS = { q: 200, locale: 16, media_format: 32, provider: 32 };
