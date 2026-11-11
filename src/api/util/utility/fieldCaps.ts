import { FieldErrors } from "../../../util/util/FieldError";

export const AUDIT_LOG_REASON_MAX = 512;

type FieldErrorMap = Record<string, { code: string; message: string }>;

export function fieldCaps() {
    const errors: FieldErrorMap = {};
    const fail = (path: string, code: string, message: string) => {
        errors[path] ??= { code, message };
    };
    const text = (path: string, value: unknown, max: number, min = 0) => {
        if (value == null) return;
        if (typeof value !== "string") return fail(path, "BASE_TYPE_STRING", "Must be a string.");
        if (value.length > max || value.length < min)
            fail(path, min > 0 ? "BASE_TYPE_BAD_LENGTH" : "BASE_TYPE_MAX_LENGTH", min > 0 ? `Must be between ${min} and ${max} in length.` : `Must be ${max} or fewer in length.`);
    };
    const list = (path: string, value: unknown, max: number): unknown[] => {
        if (value == null) return [];
        if (!Array.isArray(value)) {
            fail(path, "BASE_TYPE_ARRAY", "Must be an array.");
            return [];
        }
        if (value.length > max) fail(path, "BASE_TYPE_MAX_LENGTH", `Must be ${max} or fewer in length.`);
        return value.slice(0, max);
    };
    const texts = (path: string, value: unknown, maxItems: number, maxLength: number) => list(path, value, maxItems).forEach((item, i) => text(`${path}.${i}`, item, maxLength));
    const objects = (path: string, value: unknown, max: number) =>
        list(path, value, max).map((item, i) => {
            if (item != null && typeof item === "object" && !Array.isArray(item)) return [`${path}.${i}`, item as Record<string, unknown>] as const;
            fail(`${path}.${i}`, "DICT_TYPE_CONVERT", "Must be an object.");
            return [`${path}.${i}`, {} as Record<string, unknown>] as const;
        });
    const check = () => {
        if (Object.keys(errors).length) throw FieldErrors(errors);
    };
    return { errors, fail, text, list, texts, objects, check };
}

export function auditLogReason(header: string | string[] | undefined) {
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) return undefined;
    const decoded = (() => {
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    })();
    if (decoded.length > AUDIT_LOG_REASON_MAX)
        throw FieldErrors({
            "x-audit-log-reason": { code: "BASE_TYPE_MAX_LENGTH", message: `Must be ${AUDIT_LOG_REASON_MAX} or fewer in length.` },
        });
    return decoded;
}

export function emojiCaps(caps: ReturnType<typeof fieldCaps>, path: string, emoji: unknown) {
    if (emoji == null || typeof emoji !== "object") return;
    const { id, name } = emoji as { id?: unknown; name?: unknown };
    caps.text(`${path}.id`, id, 20);
    caps.text(`${path}.name`, name, 32);
}

export function onboardingCaps(body: unknown) {
    const caps = fieldCaps();
    const input = (body ?? {}) as Record<string, unknown>;
    caps.texts("default_channel_ids", input.default_channel_ids, 500, 20);
    for (const [path, prompt] of caps.objects("prompts", input.prompts, 15)) {
        caps.text(`${path}.id`, prompt.id, 20);
        caps.text(`${path}.title`, prompt.title, 100);
        for (const [optionPath, option] of caps.objects(`${path}.options`, prompt.options, 50)) {
            caps.text(`${optionPath}.id`, option.id, 20);
            caps.text(`${optionPath}.title`, option.title, 50);
            caps.text(`${optionPath}.description`, option.description, 100);
            caps.texts(`${optionPath}.channel_ids`, option.channel_ids, 50, 20);
            caps.texts(`${optionPath}.role_ids`, option.role_ids, 50, 20);
            caps.text(`${optionPath}.emoji_id`, option.emoji_id, 20);
            caps.text(`${optionPath}.emoji_name`, option.emoji_name, 32);
            emojiCaps(caps, `${optionPath}.emoji`, option.emoji);
        }
    }
    caps.check();
}

export function onboardingResponsesCaps(body: unknown) {
    const caps = fieldCaps();
    const input = (body ?? {}) as Record<string, unknown>;
    caps.texts("onboarding_responses", input.onboarding_responses, 750, 20);
    for (const key of ["onboarding_prompts_seen", "onboarding_responses_seen"]) {
        const seen = input[key];
        if (seen == null) continue;
        if (typeof seen !== "object" || Array.isArray(seen)) {
            caps.fail(key, "DICT_TYPE_CONVERT", "Must be an object.");
            continue;
        }
        const keys = Object.keys(seen);
        if (keys.length > 750) caps.fail(key, "BASE_TYPE_MAX_LENGTH", "Must be 750 or fewer in length.");
        keys.slice(0, 750).forEach((id) => caps.text(`${key}.${id.slice(0, 20)}`, id, 20));
    }
    caps.check();
}

export function newMemberWelcomeCaps(body: unknown) {
    const caps = fieldCaps();
    const input = (body ?? {}) as Record<string, unknown>;
    const message = input.welcome_message as Record<string, unknown> | null | undefined;
    if (message != null && typeof message === "object") {
        caps.texts("welcome_message.author_ids", message.author_ids, 10, 20);
        caps.text("welcome_message.message", message.message, 300);
    }
    for (const [field, max] of [
        ["new_member_actions", 5],
        ["resource_channels", 7],
    ] as const)
        for (const [path, item] of caps.objects(field, input[field], max)) {
            caps.text(`${path}.channel_id`, item.channel_id, 20);
            caps.text(`${path}.title`, item.title, 60);
            caps.text(`${path}.description`, item.description, 200);
            caps.text(`${path}.icon`, item.icon, 64);
            emojiCaps(caps, `${path}.emoji`, item.emoji);
        }
    caps.check();
}

export function discoveryMetadataCaps(body: unknown) {
    const caps = fieldCaps();
    const input = (body ?? {}) as Record<string, unknown>;
    caps.text("about", input.about, 2400);
    caps.texts("social_links", input.social_links, 9, 256);
    for (const [path, reason] of caps.objects("reasons_to_join", input.reasons_to_join, 4)) {
        caps.text(`${path}.reason`, reason.reason, 100);
        caps.text(`${path}.emoji_id`, reason.emoji_id, 20);
        caps.text(`${path}.emoji_name`, reason.emoji_name, 32);
    }
    caps.check();
}
