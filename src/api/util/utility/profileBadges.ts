import { In } from "typeorm";
import { Badge, BadgeOverrides, User, UserActivityStats } from "@spacebar/database";
import {
    ACCOUNT_AGE_BADGE,
    activityProgress,
    Config,
    DiscordApiErrors,
    GAME_TIME_BADGE,
    GAME_VARIETY_BADGE,
    instanceName,
    LEGACY_BADGES,
    LegacyBadgeDefinition,
    NITRO_TIER_ICONS,
    tierIconName,
    loadStaffRoles,
    moderatorBadgeRole,
    staffBadgeRole,
    STREAMING_BADGE,
    TIERED_BADGES,
    TieredBadgeDefinition,
    TieredBadgeTier,
} from "@spacebar/util";
import { arrangeBadges, BadgeSettings, badgeSettings, isStaffBadge } from "./badgeSettings";
import { isSubscriptionBadge } from "./profile";
import { ensureStaffBadge, STAFF_BADGE_ID } from "./staffBadge";
import { isModeratorAlumniBadge, moderatorRoleBadgeRow } from "./moderatorBadge";

export const DIRECTORY_STAFF_BADGE_ID = 22;
export const NITRO_BADGE_ID = 1;
export const ORBS_BADGE_ID = 16;
export const BADGE_RARITIES = [1, 2, 3, 5] as const;

const LEGACY_BY_ICON = new Map(LEGACY_BADGES.map((badge) => [badge.icon, badge]));
const LEGACY_BY_ID = new Map(LEGACY_BADGES.map((badge) => [badge.id, badge]));
const TIERED_BY_ID = new Map(TIERED_BADGES.map((badge) => [badge.id, badge]));
const NITRO_PROFILE_ID = (key: string) => (key === "starter" ? "premium" : NITRO_TIER_ICONS[key]);

const TIERED_KEYS: Record<number, string> = {
    [ACCOUNT_AGE_BADGE]: "account_age",
    [STREAMING_BADGE]: "streaming",
    [GAME_TIME_BADGE]: "game_time",
    [GAME_VARIETY_BADGE]: "game_variety",
};

export interface ProfileBadge {
    id: string;
    description: string;
    icon: string;
    link?: string;
    simple_icon_url?: string;
    rarity?: number | null;
    details?: string | null;
    settings_id: string;
}

type BadgeOwner = Pick<User, "id" | "badge_ids" | "account_preferences"> & { created_at?: Date | null; badge_overrides?: BadgeOverrides | null };

const cdnBase = () => (Config.get().cdn.endpointPublic || Config.get().api.endpointPublic || "").replace(/\/$/, "");
const artUrl = (file: string | null) => (file ? `${cdnBase()}/content-assets/${file}` : null);
const badgeIconUrl = (icon: string) => `${cdnBase()}/badge-icons/${icon}.png`;
const branded = (text: string) => text.replaceAll("{instance}", instanceName());

const DAY = 24 * 60 * 60 * 1000;

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const addYears = (date: Date, years: number) => {
    const next = new Date(date);
    next.setUTCFullYear(next.getUTCFullYear() + years);
    return next;
};

const wholeYearsBetween = (from: Date, to: Date) => {
    let years = to.getUTCFullYear() - from.getUTCFullYear();
    if (addYears(from, years) > to) years--;
    return Math.max(0, years);
};

const wholeMonthsBetween = (from: Date, to: Date) => {
    let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
    const probe = new Date(from);
    probe.setUTCMonth(probe.getUTCMonth() + months);
    if (probe > to) months--;
    return Math.max(0, months);
};

export interface TierProgress {
    value: number;
    unlocked_at: Record<string, string>;
    progress: { current: number; floor: number; threshold: number | null; unit: string; progress_helper_text: string | null };
    info_label: string | null;
}

export function accountAgeProgress(createdAt: Date, now: Date): TierProgress {
    const tiers = TIERED_BY_ID.get(ACCOUNT_AGE_BADGE)!.tiers;
    const years = wholeYearsBetween(createdAt, now);
    const unlocked_at = Object.fromEntries(tiers.filter((tier) => tier.threshold <= years).map((tier) => [tier.key, addYears(createdAt, tier.threshold).toISOString()]));
    const next = tiers.find((tier) => tier.threshold > years);
    const floorDate = addYears(createdAt, Math.min(years, tiers.at(-1)!.threshold));
    const days = (date: Date) => Math.floor((date.getTime() - createdAt.getTime()) / DAY);
    let helper: string | null = null;
    if (next) {
        const nextDate = addYears(createdAt, next.threshold);
        const daysLeft = Math.max(1, Math.ceil((nextDate.getTime() - now.getTime()) / DAY));
        const monthsLeft = Math.ceil(daysLeft / 30.44);
        helper = daysLeft < 31 ? `${plural(daysLeft, "more day", "more days")}` : `${plural(monthsLeft, "more month", "more months")}`;
    }
    const months = wholeMonthsBetween(createdAt, now) - years * 12;
    const parts = [years ? plural(years, "year") : null, months ? plural(months, "month") : null].filter(Boolean);
    return {
        value: years,
        unlocked_at,
        progress: {
            current: days(now),
            floor: years > 0 ? days(floorDate) : 0,
            threshold: next ? days(addYears(createdAt, next.threshold)) : null,
            unit: "days",
            progress_helper_text: helper,
        },
        info_label: parts.length ? parts.join(", ") : "Less than a month",
    };
}

const addMonths = (date: Date, months: number) => {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
};

const durationText = (months: number) =>
    [Math.floor(months / 12) ? plural(Math.floor(months / 12), "year") : null, months % 12 ? plural(months % 12, "month") : null].filter(Boolean).join(", ");

export function nitroProgress(since: Date, now: Date): TierProgress {
    const tiers = TIERED_BY_ID.get(NITRO_BADGE_ID)!.tiers;
    const months = since > now ? -1 : wholeMonthsBetween(since, now);
    const reached = tiers.filter((tier) => tier.threshold <= months);
    const next = tiers.find((tier) => tier.threshold > months);
    const days = (date: Date) => Math.max(0, Math.floor((date.getTime() - since.getTime()) / DAY));
    let helper: string | null = null;
    if (next) {
        const daysLeft = Math.max(1, Math.ceil((addMonths(since, next.threshold).getTime() - now.getTime()) / DAY));
        helper = daysLeft < 31 ? plural(daysLeft, "more day", "more days") : plural(Math.ceil(daysLeft / 30.44), "more month", "more months");
    }
    return {
        value: months,
        unlocked_at: Object.fromEntries(reached.map((tier) => [tier.key, addMonths(since, tier.threshold).toISOString()])),
        progress: {
            current: days(now),
            floor: reached.length ? days(addMonths(since, reached.at(-1)!.threshold)) : 0,
            threshold: next ? days(addMonths(since, next.threshold)) : null,
            unit: "days",
            progress_helper_text: helper,
        },
        info_label: months > 0 ? `${durationText(months)} of Features` : months === 0 ? "Less than a month of Features" : null,
    };
}

const ACTIVITY_TEXT: Record<number, { info: (n: number) => string; helper: (n: number) => string }> = {
    [STREAMING_BADGE]: { info: (n) => `${plural(n, "hour")} streamed to others`, helper: (n) => plural(n, "more hour", "more hours") },
    [GAME_TIME_BADGE]: { info: (n) => `${plural(n, "hour")} of games played`, helper: (n) => `${plural(n, "more hour", "more hours")} of games` },
    [GAME_VARIETY_BADGE]: { info: (n) => `${plural(n, "game")} played`, helper: (n) => plural(n, "more game", "more games") },
};

export function activityTierProgress(badge: TieredBadgeDefinition, value: number, unlocks: Record<string, string> = {}, fallbackUnlock?: string): TierProgress {
    const reached = badge.tiers.filter((tier) => value >= tier.threshold);
    const next = badge.tiers.find((tier) => value < tier.threshold);
    const whole = Math.floor(value);
    const text = ACTIVITY_TEXT[badge.id];
    return {
        value,
        unlocked_at: Object.fromEntries(reached.map((tier) => [tier.key, unlocks[tier.key] ?? fallbackUnlock ?? new Date().toISOString()])),
        progress: {
            current: whole,
            floor: reached.at(-1)?.threshold ?? 0,
            threshold: next?.threshold ?? null,
            unit: badge.tiers[0].unit,
            progress_helper_text: next ? text.helper(Math.max(1, Math.ceil(next.threshold - value))) : null,
        },
        info_label: whole > 0 ? text.info(whole) : null,
    };
}

async function ownerDetails(user: BadgeOwner) {
    if (user.created_at !== undefined && user.badge_overrides !== undefined) return { created_at: user.created_at, badge_overrides: user.badge_overrides };
    return User.findOne({ where: { id: user.id }, select: { id: true, created_at: true, badge_overrides: true } });
}

export async function tieredProgress(user: BadgeOwner) {
    const [stats, account] = await Promise.all([UserActivityStats.findOne({ where: { user_id: user.id } }), ownerDetails(user)]);
    const values = activityProgress(stats);
    const overrides = account?.badge_overrides ?? {};
    const progress = new Map<number, TierProgress>();
    const ageSince = overrides.account_age_since ? new Date(overrides.account_age_since) : account?.created_at ? new Date(account.created_at) : null;
    if (ageSince && !Number.isNaN(ageSince.getTime())) progress.set(ACCOUNT_AGE_BADGE, accountAgeProgress(ageSince, new Date()));
    const nitroSince = account?.badge_overrides?.nitro_since ? new Date(account.badge_overrides.nitro_since) : null;
    if (nitroSince && !Number.isNaN(nitroSince.getTime())) {
        const nitro = nitroProgress(nitroSince, new Date());
        if (Object.keys(nitro.unlocked_at).length) progress.set(NITRO_BADGE_ID, nitro);
    }
    for (const id of [STREAMING_BADGE, GAME_TIME_BADGE, GAME_VARIETY_BADGE] as const) {
        const offset = overrides.progress_offsets?.[id] ?? 0;
        const unlocks = offset ? undefined : stats?.tier_unlocks?.[id];
        progress.set(id, activityTierProgress(TIERED_BY_ID.get(id)!, Math.max(0, values[id] + offset), unlocks, overrides.levels_set_at?.[id]));
    }
    return progress;
}

const currentTier = (badge: TieredBadgeDefinition, progress: TierProgress) => [...badge.tiers].reverse().find((tier) => progress.unlocked_at[tier.key]);

function tieredProfileBadge(badge: TieredBadgeDefinition, progress: TierProgress): ProfileBadge | null {
    const tier = currentTier(badge, progress);
    if (!tier) return null;
    if (badge.id === NITRO_BADGE_ID) {
        const since = new Date(Object.values(progress.unlocked_at).sort()[0]);
        const id = NITRO_PROFILE_ID(tier.key);
        return {
            id,
            description: `Features since ${since.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`,
            icon: NITRO_TIER_ICONS[tier.key],
            simple_icon_url: artUrl(tier.simple)!,
            settings_id: String(badge.id),
        };
    }
    return { id: TIERED_KEYS[badge.id], description: badge.name, icon: tierIconName(badge.id, tier.key), simple_icon_url: artUrl(tier.simple)!, settings_id: String(badge.id) };
}

export async function localProfileBadges(user: BadgeOwner, progress?: Map<number, TierProgress>): Promise<ProfileBadge[]> {
    const ids = user.badge_ids ?? [];
    const rows: { id: string; description: string; icon: string; link?: string; rarity?: number | null; details?: string | null }[] = ids.length
        ? await Badge.find({ where: { id: In(ids) } })
        : [];
    const snap = await loadStaffRoles();
    const moderatorRole = rows.some(isModeratorAlumniBadge) ? null : moderatorBadgeRole(user.id, snap);
    if (moderatorRole) rows.unshift(moderatorRoleBadgeRow(moderatorRole));
    const role = user.badge_ids?.includes(STAFF_BADGE_ID) ? null : staffBadgeRole(user.id, snap);
    if (role) {
        const staffBadge = await ensureStaffBadge();
        rows.unshift({ id: `staff-role-${role.id}`, description: `${instanceName()} ${role.name}`, icon: staffBadge.icon, link: staffBadge.link });
    }
    const badges: ProfileBadge[] = rows
        .filter((row) => !isSubscriptionBadge(row))
        .map((row) => {
            if (isStaffBadge(row)) {
                const staff = LEGACY_BY_ID.get(DIRECTORY_STAFF_BADGE_ID)!;
                const fixed = row.id === STAFF_BADGE_ID;
                return {
                    ...row,
                    id: fixed ? "staff" : row.id,
                    description: fixed ? branded(staff.name) : row.description,
                    simple_icon_url: artUrl(staff.simple)!,
                    settings_id: String(DIRECTORY_STAFF_BADGE_ID),
                };
            }
            const legacy = LEGACY_BY_ICON.get(row.icon);
            if (legacy) return { ...row, id: legacy.key, description: branded(legacy.name), simple_icon_url: artUrl(legacy.simple)!, settings_id: String(legacy.id) };
            return { ...row, settings_id: row.id };
        });
    const tiers = progress ?? (await tieredProgress(user));
    for (const badge of TIERED_BADGES) {
        const entry = tiers.get(badge.id);
        const profileBadge = entry ? tieredProfileBadge(badge, entry) : null;
        if (profileBadge) badges.push(profileBadge);
    }
    return badges;
}

export function normalizeBadgeSettings(settings: BadgeSettings, badges: ProfileBadge[]): BadgeSettings {
    const translate = new Map(badges.flatMap((badge) => [[badge.id, badge.settings_id] as const]));
    const rowIds = new Map<string, string>();
    for (const legacy of LEGACY_BADGES) rowIds.set(legacy.key, String(legacy.id));
    const map = (id: string) => translate.get(id) ?? rowIds.get(id) ?? id;
    return { display_order: [...new Set(settings.display_order.map(map))], hidden_badges: [...new Set(settings.hidden_badges.map(map))] };
}

export function arrangeProfileBadges(badges: ProfileBadge[], settings: BadgeSettings) {
    const keyed = badges.map((badge) => ({ ...badge, id: badge.settings_id, profile_id: badge.id }));
    const { visible, hidden } = arrangeBadges(keyed, normalizeBadgeSettings(settings, badges));
    const back = ({ profile_id, ...badge }: (typeof keyed)[number]): ProfileBadge => ({ ...badge, id: profile_id });
    return { visible: visible.map(back), hidden: hidden.map(back) };
}

export const publicProfileBadges = (badges: ProfileBadge[]) => badges.map(({ settings_id, rarity, details, ...badge }) => badge);

const ORBS_OWNED_DESCRIPTION = "Unlocked in the Orbs Shop.";

const legacyEntry = (legacy: LegacyBadgeDefinition, name: string, icon: string, link: string | undefined, hidden: boolean, owned = true) => ({
    badge_id: legacy.id,
    name,
    description: legacy.earnable && owned ? ORBS_OWNED_DESCRIPTION : branded(legacy.description),
    info_label: legacy.info_label,
    rarity: legacy.rarity,
    simple_icon_url: artUrl(legacy.simple),
    simple_icon_raster_url: legacy.raster ? artUrl(legacy.raster) : badgeIconUrl(icon),
    ...(legacy.complex ? { complex_icon_static_url: artUrl(legacy.complex) } : {}),
    link: link ?? null,
    is_earnable: legacy.earnable,
    owned,
    hidden,
    progress: null,
});

const tierEntry = (tier: TieredBadgeTier, owned: boolean) => ({
    key: tier.key,
    name: tier.name,
    rarity: tier.rarity,
    simple_icon_url: artUrl(tier.simple),
    simple_icon_raster_url: artUrl(tier.raster),
    complex_icon_static_url: artUrl(tier.complex),
    ...(tier.animated ? { complex_icon_animated_url: artUrl(tier.animated) } : {}),
    requirements: [{ progress_type: 1, threshold: tier.threshold, unit: tier.unit }],
    owned,
    milestone_text: tier.milestone_text,
});

export function tieredDirectoryBadge(badge: TieredBadgeDefinition, progress: TierProgress, hidden: boolean, self: boolean) {
    const current = currentTier(badge, progress);
    const next = badge.tiers.find((tier) => !progress.unlocked_at[tier.key]);
    const shown = current ?? badge.tiers[0];
    const firstUnlock = badge.tiers.map((tier) => progress.unlocked_at[tier.key]).find(Boolean) ?? null;
    return {
        badge_id: badge.id,
        name: branded(badge.name),
        description: branded(badge.description),
        leveling_instructions: branded(badge.leveling_instructions),
        info_label: progress.info_label,
        rarity: shown.rarity,
        simple_icon_url: artUrl(shown.simple),
        simple_icon_raster_url: artUrl(shown.raster),
        complex_icon_static_url: artUrl(shown.complex),
        ...(shown.animated ? { complex_icon_animated_url: artUrl(shown.animated) } : {}),
        is_earnable: true,
        owned: current !== undefined,
        hidden,
        obtained_at: firstUnlock,
        current_tier: current?.key ?? null,
        next_tier: next?.key ?? null,
        tier_obtained_at: progress.unlocked_at,
        tiers: badge.tiers.map((tier) => tierEntry(tier, !!progress.unlocked_at[tier.key])),
        progress: self ? [{ progress_type: 1, ...progress.progress, window: null }] : null,
    };
}

const customEntry = (badge: ProfileBadge, hidden: boolean) => ({
    badge_id: badge.settings_id,
    name: badge.description,
    description: badge.details ? branded(badge.details) : badge.description,
    rarity: badge.rarity ?? 1,
    owned: true,
    hidden,
    is_earnable: false,
    simple_icon_url: badge.simple_icon_url ?? badgeIconUrl(badge.icon),
    simple_icon_raster_url: badgeIconUrl(badge.icon),
    link: badge.link ?? null,
    tiers: [],
    current_tier: null,
    next_tier: null,
    requirements: [],
    progress: [],
    obtained_at: null,
    tier_obtained_at: null,
});

const withRarity = <T extends { badge_id: number | string; rarity: number }>(entry: T, overrides: Record<string, number> | undefined): T => {
    const rarity = overrides?.[String(entry.badge_id)];
    return rarity && BADGE_RARITIES.includes(rarity as never) ? { ...entry, rarity } : entry;
};

export async function badgeDirectory(user: BadgeOwner, self: boolean) {
    const account = await ownerDetails(user);
    const owner = { ...user, created_at: account?.created_at ?? null, badge_overrides: account?.badge_overrides ?? null };
    const overrides = owner.badge_overrides?.rarity;
    const progress = await tieredProgress(owner);
    const badges = await localProfileBadges(owner, progress);
    const { visible, hidden } = arrangeProfileBadges(badges, badgeSettings(user));
    const entry = (badge: ProfileBadge, isHidden: boolean) => {
        const id = Number(badge.settings_id);
        const legacy = LEGACY_BY_ID.get(id);
        if (legacy) {
            const base = legacyEntry(legacy, id === DIRECTORY_STAFF_BADGE_ID ? badge.description : branded(legacy.name), badge.icon, badge.link, isHidden);
            return withRarity(badge.rarity ? { ...base, rarity: badge.rarity } : base, overrides);
        }
        const tiered = TIERED_BY_ID.get(id);
        if (tiered && progress.has(id)) return withRarity(tieredDirectoryBadge(tiered, progress.get(id)!, isHidden, self), overrides);
        return withRarity(customEntry(badge, isHidden), overrides);
    };
    const owned = [...visible.map((badge) => entry(badge, false)), ...(self ? hidden.map((badge) => entry(badge, true)) : [])];
    if (!self) return owned;
    const ownedIds = new Set(badges.map((badge) => badge.settings_id));
    const earnable = TIERED_BADGES.filter((badge) => !ownedIds.has(String(badge.id)) && progress.has(badge.id) && badge.id !== NITRO_BADGE_ID).map((badge) =>
        tieredDirectoryBadge(badge, progress.get(badge.id)!, false, true),
    );
    const orbs = LEGACY_BY_ID.get(ORBS_BADGE_ID)!;
    const orbsEntry = ownedIds.has(String(ORBS_BADGE_ID)) ? [] : [legacyEntry(orbs, branded(orbs.name), orbs.icon, undefined, false, false)];
    return [...owned, ...earnable, ...orbsEntry];
}

export async function loadBadgeOwner(userId: string, viewerId: string) {
    const id = userId === "@me" ? viewerId : userId;
    if (!/^\d{1,20}$/.test(id)) throw DiscordApiErrors.UNKNOWN_USER;
    const user = await User.findOne({
        where: { id },
        select: { id: true, badge_ids: true, account_preferences: true, created_at: true, badge_overrides: true },
    });
    if (!user) throw DiscordApiErrors.UNKNOWN_USER;
    return { user, self: user.id === viewerId };
}
