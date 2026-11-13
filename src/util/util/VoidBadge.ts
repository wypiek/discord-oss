export const VOID_BADGE_ID = "the_void";
export const VOID_BADGE_NAME = "The Void";
export const VOID_BADGE_DESCRIPTION = "Granted by {instance} staff.";
export const VOID_BADGE_INSTRUCTIONS = "Only {instance} staff can grant this badge or change its level.";
export const VOID_CURRENT_TIER_TEXT = "Current level";

export interface VoidBadgeTier {
    key: string;
    name: string;
    rarity: number;
}

export interface VoidBadgeGrant {
    tier: string;
    granted_at: string;
    tier_set_at: string;
}

export const VOID_BADGE_TIERS: readonly VoidBadgeTier[] = [
    { key: "eclipse", name: "Eclipse", rarity: 1 },
    { key: "stardust", name: "Stardust", rarity: 1 },
    { key: "meteorite", name: "Meteorite", rarity: 2 },
    { key: "comet", name: "Comet", rarity: 2 },
    { key: "pulsar", name: "Pulsar", rarity: 2 },
    { key: "quasar", name: "Quasar", rarity: 3 },
    { key: "aurora", name: "Aurora", rarity: 3 },
    { key: "nebula", name: "Nebula", rarity: 3 },
    { key: "nova", name: "Nova", rarity: 5 },
    { key: "supernova", name: "Supernova", rarity: 5 },
];

const VOID_ICON_PREFIX = `${VOID_BADGE_ID}_`;

export const voidBadgeTier = (key: unknown) => (typeof key === "string" ? VOID_BADGE_TIERS.find((tier) => tier.key === key) : undefined);

export const voidBadgeIcon = (key: string) => `${VOID_ICON_PREFIX}${key}`;

export function voidBadgeArtFile(file: string) {
    const match = /^the_void_([a-z]+)\.(png|svg)$/.exec(file);
    if (!match || !voidBadgeTier(match[1])) return null;
    return `badges/void/${match[1]}.${match[2]}`;
}

export function currentVoidGrant(grant: VoidBadgeGrant | null | undefined) {
    const tier = voidBadgeTier(grant?.tier);
    if (!grant || !tier) return null;
    const grantedAt = new Date(grant.granted_at);
    if (Number.isNaN(grantedAt.getTime())) return null;
    const tierSetAt = new Date(grant.tier_set_at);
    return {
        tier,
        index: VOID_BADGE_TIERS.indexOf(tier),
        granted_at: grantedAt.toISOString(),
        tier_set_at: Number.isNaN(tierSetAt.getTime()) ? grantedAt.toISOString() : tierSetAt.toISOString(),
    };
}

export function grantVoidBadge(current: VoidBadgeGrant | null | undefined, key: string | null, now = new Date()): VoidBadgeGrant | undefined {
    if (key === null) return undefined;
    const tier = voidBadgeTier(key);
    if (!tier) throw new RangeError(`Choose one of ${VOID_BADGE_TIERS.map((candidate) => candidate.key).join(", ")}`);
    const existing = currentVoidGrant(current);
    if (existing?.tier.key === tier.key) return { tier: tier.key, granted_at: existing.granted_at, tier_set_at: existing.tier_set_at };
    return { tier: tier.key, granted_at: existing?.granted_at ?? now.toISOString(), tier_set_at: now.toISOString() };
}
