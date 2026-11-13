import { FieldErrors } from "@spacebar/util";

export const TEMPORARY_ROLE_MIN_SECONDS = 60;
export const TEMPORARY_ROLE_MAX_SECONDS = 365 * 24 * 60 * 60;
export const TEMPORARY_ROLE_MAX_CHANGES = 250;
const CLOCK_SKEW_MS = 5_000;
const SNOWFLAKE = /^\d{1,20}$/;
const WINDOW_MESSAGE = "Temporary roles must last between 1 minute and 365 days.";

function windowError(field: string, code: string) {
    return FieldErrors({ [field]: { code, message: WINDOW_MESSAGE } });
}

export function assertExpiryWindow(expires_at: Date, field: string, now = Date.now()) {
    const delay = expires_at.getTime() - now;
    if (Number.isNaN(delay)) throw FieldErrors({ [field]: { code: "BASE_TYPE_BAD_DATETIME", message: "Could not interpret the date. Use an ISO 8601 timestamp." } });
    if (delay < TEMPORARY_ROLE_MIN_SECONDS * 1000 - CLOCK_SKEW_MS) throw windowError(field, "DATETIME_TOO_SOON");
    if (delay > TEMPORARY_ROLE_MAX_SECONDS * 1000 + 60_000) throw windowError(field, "DATETIME_TOO_LATE");
    return expires_at;
}

export function parseExpiryTimestamp(raw: unknown, field: string, now = Date.now()) {
    if (typeof raw !== "string" || raw.length > 64 || !raw.trim())
        throw FieldErrors({ [field]: { code: "BASE_TYPE_BAD_DATETIME", message: "Could not interpret the date. Use an ISO 8601 timestamp." } });
    return assertExpiryWindow(new Date(raw), field, now);
}

export function parseExpiryDuration(raw: unknown, field: string, now = Date.now()) {
    const seconds = typeof raw === "string" && /^\d{1,12}$/.test(raw) ? Number(raw) : raw;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds))
        throw FieldErrors({ [field]: { code: "NUMBER_TYPE_COERCE", message: "Must be a whole number of seconds." } });
    if (seconds < TEMPORARY_ROLE_MIN_SECONDS) throw windowError(field, "NUMBER_TYPE_MIN");
    if (seconds > TEMPORARY_ROLE_MAX_SECONDS) throw windowError(field, "NUMBER_TYPE_MAX");
    return new Date(now + seconds * 1000);
}

export function resolveRoleAssignmentExpiry(body: unknown, now = Date.now()): Date | null {
    if (body == null || typeof body !== "object" || Array.isArray(body)) return null;
    const { expires_at, duration_seconds } = body as { expires_at?: unknown; duration_seconds?: unknown };
    const hasTimestamp = expires_at !== undefined && expires_at !== null;
    const hasDuration = duration_seconds !== undefined && duration_seconds !== null;
    if (hasTimestamp && hasDuration)
        throw FieldErrors({
            expires_at: { code: "BASE_TYPE_INVALID", message: "Send either expires_at or duration_seconds, not both." },
            duration_seconds: { code: "BASE_TYPE_INVALID", message: "Send either expires_at or duration_seconds, not both." },
        });
    if (hasTimestamp) return parseExpiryTimestamp(expires_at, "expires_at", now);
    if (hasDuration) return parseExpiryDuration(duration_seconds, "duration_seconds", now);
    return null;
}

export function resolveRoleExpirationChanges(raw: unknown, guild_id: string, now = Date.now()): Map<string, Date | null> {
    const changes = new Map<string, Date | null>();
    if (raw == null) return changes;
    if (typeof raw !== "object" || Array.isArray(raw))
        throw FieldErrors({ role_expirations: { code: "DICT_TYPE_CONVERT", message: "Must be an object of role IDs to timestamps." } });
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > TEMPORARY_ROLE_MAX_CHANGES)
        throw FieldErrors({ role_expirations: { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${TEMPORARY_ROLE_MAX_CHANGES} or fewer in length.` } });
    for (const [role_id, value] of entries) {
        const field = `role_expirations.${role_id}`;
        if (!SNOWFLAKE.test(role_id) || role_id === guild_id) throw FieldErrors({ [field]: { code: "BASE_TYPE_INVALID", message: "Not a role that can be assigned." } });
        changes.set(role_id, value === null ? null : parseExpiryTimestamp(value, field, now));
    }
    return changes;
}

export function roleExpiryAuditReason(reason: string | string[] | undefined, notes: string[]) {
    const given = Array.isArray(reason) ? reason[0] : reason;
    if (!notes.length) return given;
    const summary = notes.join("; ");
    return given ? `${given} (${summary})` : summary;
}

export function describeRoleExpiry(name: string | undefined, expires_at: Date | null) {
    return expires_at ? `${name ?? "Role"} is temporary until ${expires_at.toISOString()}` : `${name ?? "Role"} is permanent`;
}
