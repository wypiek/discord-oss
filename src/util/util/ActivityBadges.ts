import { In } from "typeorm";
import { User, UserActivityStats } from "@spacebar/database";
import { TIERED_BADGES, TieredBadgeTier } from "./BadgeCatalog";

export const ACCOUNT_AGE_BADGE = 18;
export const STREAMING_BADGE = 19;
export const GAME_TIME_BADGE = 20;
export const GAME_VARIETY_BADGE = 21;

export type ActivityBadgeId = typeof ACCOUNT_AGE_BADGE | typeof STREAMING_BADGE | typeof GAME_TIME_BADGE | typeof GAME_VARIETY_BADGE;

export type ActivityBadgeTier = Pick<TieredBadgeTier, "key" | "name" | "threshold">;

export const ACTIVITY_BADGE_TIERS = Object.fromEntries(TIERED_BADGES.map((badge) => [badge.id, badge.tiers])) as Record<ActivityBadgeId, TieredBadgeTier[]>;

export const MAX_TRACKED_GAMES = 200;

export type ActivityCredit = { user_id: string; game_seconds?: number; stream_seconds?: number; games?: string[] };

export const hasPersonalizationConsent = (user: Pick<User, "account_preferences">) => user.account_preferences?.consents?.personalization === true;

export function activityProgress(
    stats: Pick<UserActivityStats, "game_seconds" | "stream_seconds" | "games"> | null,
): Record<Exclude<ActivityBadgeId, typeof ACCOUNT_AGE_BADGE>, number> {
    return {
        [STREAMING_BADGE]: Number(stats?.stream_seconds ?? 0) / 3600,
        [GAME_TIME_BADGE]: Number(stats?.game_seconds ?? 0) / 3600,
        [GAME_VARIETY_BADGE]: stats?.games?.length ?? 0,
    };
}

export function recordTierUnlocks(stats: UserActivityStats, at: Date) {
    const progress = activityProgress(stats);
    const unlocks = { ...stats.tier_unlocks };
    for (const [badge, value] of Object.entries(progress)) {
        const reached = { ...unlocks[badge] };
        for (const tier of ACTIVITY_BADGE_TIERS[Number(badge) as ActivityBadgeId]) if (value >= tier.threshold && !reached[tier.key]) reached[tier.key] = at.toISOString();
        if (Object.keys(reached).length) unlocks[badge] = reached;
    }
    stats.tier_unlocks = unlocks;
}

export function mergeCredits(credits: ActivityCredit[]) {
    const merged = new Map<string, Required<ActivityCredit>>();
    for (const credit of credits) {
        const entry = merged.get(credit.user_id) ?? { user_id: credit.user_id, game_seconds: 0, stream_seconds: 0, games: [] };
        entry.game_seconds = Math.max(entry.game_seconds, credit.game_seconds ?? 0);
        entry.stream_seconds = Math.max(entry.stream_seconds, credit.stream_seconds ?? 0);
        entry.games = [...new Set([...entry.games, ...(credit.games ?? [])])];
        merged.set(credit.user_id, entry);
    }
    return [...merged.values()];
}

export function applyCredit(stats: UserActivityStats, credit: Required<ActivityCredit>, at: Date) {
    stats.game_seconds = String(BigInt(stats.game_seconds ?? 0) + BigInt(Math.round(credit.game_seconds)));
    stats.stream_seconds = String(BigInt(stats.stream_seconds ?? 0) + BigInt(Math.round(credit.stream_seconds)));
    const games = new Set(stats.games ?? []);
    for (const game of credit.games) if (games.size < MAX_TRACKED_GAMES) games.add(game);
    stats.games = [...games];
    stats.updated_at = at;
    recordTierUnlocks(stats, at);
}

export async function creditActivity(credits: ActivityCredit[], at = new Date()) {
    const merged = mergeCredits(credits).filter((credit) => credit.game_seconds > 0 || credit.stream_seconds > 0 || credit.games.length > 0);
    if (!merged.length) return 0;
    const users = await User.find({ where: { id: In(merged.map((credit) => credit.user_id)) }, select: { id: true, account_preferences: true } });
    const consenting = new Set(users.filter(hasPersonalizationConsent).map((user) => user.id));
    const eligible = merged.filter((credit) => consenting.has(credit.user_id));
    if (!eligible.length) return 0;
    const existing = new Map((await UserActivityStats.find({ where: { user_id: In(eligible.map((credit) => credit.user_id)) } })).map((stats) => [stats.user_id, stats]));
    const rows = eligible.map((credit) => {
        const stats =
            existing.get(credit.user_id) ??
            Object.assign(new UserActivityStats(), { user_id: credit.user_id, game_seconds: "0", stream_seconds: "0", games: [], tier_unlocks: {} });
        applyCredit(stats, credit, at);
        return stats;
    });
    await UserActivityStats.save(rows);
    return rows.length;
}

export const gameKey = (activity: { type?: number; name?: string; application_id?: string }) =>
    activity.type === 0 && (activity.application_id || activity.name?.trim()) ? (activity.application_id ?? `name:${activity.name!.trim().toLowerCase()}`) : null;

export const NITRO_TIER_ICONS: Record<string, string> = {
    starter: "2ba85e8026a8614b640c2837bcdfe21b",
    bronze: "premium_tenure_1_month_v2",
    silver: "premium_tenure_3_month_v2",
    gold: "premium_tenure_6_month_v2",
    platinum: "premium_tenure_12_month_v2",
    diamond: "premium_tenure_24_month_v2",
    emerald: "premium_tenure_36_month_v2",
    ruby: "premium_tenure_60_month_v2",
    opal: "premium_tenure_72_month_v2",
};

export const TIERED_PROFILE_KEYS: Record<number, string> = {
    [ACCOUNT_AGE_BADGE]: "account_age",
    [STREAMING_BADGE]: "streaming",
    [GAME_TIME_BADGE]: "game_time",
    [GAME_VARIETY_BADGE]: "game_variety",
};

export const tierIconName = (badgeId: number, tierKey: string) => `${TIERED_PROFILE_KEYS[badgeId]}_${tierKey}`;

const tierRaster = (badgeId: number, tierKey: string) => TIERED_BADGES.find((badge) => badge.id === badgeId)?.tiers.find((tier) => tier.key === tierKey)?.raster ?? null;

export function nitroTierArt(icon: string) {
    const nitroKey = Object.entries(NITRO_TIER_ICONS).find(([, name]) => name === icon)?.[0];
    if (nitroKey) return tierRaster(1, nitroKey);
    for (const [badgeId, prefix] of Object.entries(TIERED_PROFILE_KEYS)) if (icon.startsWith(`${prefix}_`)) return tierRaster(Number(badgeId), icon.slice(prefix.length + 1));
    return null;
}
