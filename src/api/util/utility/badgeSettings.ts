import type { User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { PRIDE_BADGES } from "./prideBadges";
import { STAFF_BADGE_ID } from "./staffBadge";

export const MAX_BADGE_SETTING_IDS = 256;

export interface BadgeSettings {
    display_order: string[];
    hidden_badges: string[];
}

export const isStaffBadge = (badge: { id: string }) => badge.id === STAFF_BADGE_ID || badge.id.startsWith("staff-role-");

const prideBadgeIds: ReadonlySet<string> = new Set(PRIDE_BADGES.map((badge) => badge.id as string));
const isHideable = (badge: { id: string }) => !isStaffBadge(badge) && !prideBadgeIds.has(badge.id);

export const badgeSettings = (user: Pick<User, "account_preferences">): BadgeSettings => ({
    display_order: user.account_preferences?.badge_settings?.display_order ?? [],
    hidden_badges: user.account_preferences?.badge_settings?.hidden_badges ?? [],
});

export function arrangeBadges<T extends { id: string }>(badges: T[], settings: BadgeSettings) {
    const hidden = new Set(settings.hidden_badges.filter((id) => isHideable({ id })));
    const position = new Map(settings.display_order.map((id, index) => [id, index]));
    const rank = (badge: T, index: number) => position.get(badge.id) ?? settings.display_order.length + index;
    const ordered = badges
        .filter((badge) => !isStaffBadge(badge))
        .map((badge, index) => ({ badge, rank: rank(badge, index) }))
        .sort((a, b) => a.rank - b.rank)
        .map(({ badge }) => badge);
    return {
        visible: [...badges.filter(isStaffBadge), ...ordered.filter((badge) => !hidden.has(badge.id))],
        hidden: ordered.filter((badge) => hidden.has(badge.id)),
    };
}

const settingIds = (value: unknown, field: string) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > MAX_BADGE_SETTING_IDS || !value.every((id) => (typeof id === "string" && /^[\w-]{1,64}$/.test(id)) || Number.isSafeInteger(id)))
        throw FieldErrors({ [field]: { code: "BASE_TYPE_BAD_FORMAT", message: `Must be a list of at most ${MAX_BADGE_SETTING_IDS} badge ids` } });
    return [...new Set(value.map(String))];
};

export function mergeBadgeSettings(current: BadgeSettings, owned: { id: string }[], body: { display_order?: unknown; hidden_badges?: unknown }): BadgeSettings {
    const display_order = settingIds(body.display_order, "display_order") ?? current.display_order;
    const hidden_badges = settingIds(body.hidden_badges, "hidden_badges") ?? current.hidden_badges;
    const arrangeable = new Set(owned.filter((badge) => !isStaffBadge(badge)).map((badge) => badge.id));
    return {
        display_order: display_order.filter((id) => arrangeable.has(id)),
        hidden_badges: hidden_badges.filter((id) => arrangeable.has(id) && isHideable({ id })),
    };
}
