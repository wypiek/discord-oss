import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { adminCustomizationTarget, recordAdminCustomization } from "@spacebar/api/util/handlers/AdminUserCustomization";
import { BADGE_RARITIES, badgeDirectory, NITRO_BADGE_ID, nitroProgress, tieredProgress } from "@spacebar/api/util/utility/profileBadges";
import { notifyUserUpdate } from "@spacebar/api/util/utility/moderatorBadge";
import { BadgeOverrides, getDatabase, User, UserActivityStats } from "@spacebar/database";
import {
    ACCOUNT_AGE_BADGE,
    activityProgress,
    broadcastUserUpdate,
    currentVoidGrant,
    FieldErrors,
    GAME_TIME_BADGE,
    GAME_VARIETY_BADGE,
    grantVoidBadge,
    STREAMING_BADGE,
    TIERED_BADGES,
    VOID_BADGE_ID,
    VOID_BADGE_TIERS,
    voidBadgeIcon,
    voidBadgeTier,
} from "@spacebar/util";
import { AdminBadgeOverridesSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const NITRO_TIERS = TIERED_BADGES.find((badge) => badge.id === NITRO_BADGE_ID)!.tiers;
const LEVELLED_BADGES = [ACCOUNT_AGE_BADGE, STREAMING_BADGE, GAME_TIME_BADGE, GAME_VARIETY_BADGE] as const;
type ActivityValues = Record<typeof STREAMING_BADGE | typeof GAME_TIME_BADGE | typeof GAME_VARIETY_BADGE, number>;

const subtractMonths = (date: Date, months: number) => {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() - months);
    return next;
};

const subtractYears = (date: Date, years: number) => {
    const next = new Date(date);
    next.setUTCFullYear(next.getUTCFullYear() - years);
    return next;
};

export function applyBadgeOverrides(
    current: BadgeOverrides,
    body: AdminBadgeOverridesSchema,
    now = new Date(),
    real: ActivityValues = { [STREAMING_BADGE]: 0, [GAME_TIME_BADGE]: 0, [GAME_VARIETY_BADGE]: 0 },
): BadgeOverrides {
    const next: BadgeOverrides = {
        ...current,
        rarity: { ...current.rarity },
        progress_offsets: { ...current.progress_offsets },
        levels_set_at: { ...current.levels_set_at },
    };
    for (const [id, key] of Object.entries(body.levels ?? {})) {
        const badgeId = Number(id) as (typeof LEVELLED_BADGES)[number];
        if (!LEVELLED_BADGES.includes(badgeId)) throw FieldErrors({ levels: { code: "BASE_TYPE_CHOICES", message: `Levels can be set for badges ${LEVELLED_BADGES.join(", ")}` } });
        const tiers = TIERED_BADGES.find((badge) => badge.id === badgeId)!.tiers;
        if (key === null) {
            if (badgeId === ACCOUNT_AGE_BADGE) delete next.account_age_since;
            else {
                delete next.progress_offsets![id];
                delete next.levels_set_at![id];
            }
            continue;
        }
        const tier = tiers.find((candidate) => candidate.key === key);
        if (!tier) throw FieldErrors({ levels: { code: "BASE_TYPE_CHOICES", message: `Choose one of ${tiers.map((candidate) => candidate.key).join(", ")} for badge ${id}` } });
        if (badgeId === ACCOUNT_AGE_BADGE) next.account_age_since = new Date(subtractYears(now, tier.threshold).getTime() - 60_000).toISOString();
        else {
            next.progress_offsets![id] = tier.threshold - real[badgeId];
            next.levels_set_at![id] = now.toISOString();
        }
    }
    if (!Object.keys(next.progress_offsets!).length) delete next.progress_offsets;
    if (!Object.keys(next.levels_set_at!).length) delete next.levels_set_at;
    if (body.nitro_tier !== undefined) {
        if (body.nitro_tier === null) delete next.nitro_since;
        else {
            const tier = NITRO_TIERS.find((candidate) => candidate.key === body.nitro_tier);
            if (!tier) throw FieldErrors({ nitro_tier: { code: "BASE_TYPE_CHOICES", message: `Choose one of ${NITRO_TIERS.map((candidate) => candidate.key).join(", ")}` } });
            next.nitro_since = new Date(subtractMonths(now, tier.threshold).getTime() - 60_000).toISOString();
        }
    }
    if (body.nitro_since !== undefined) {
        if (body.nitro_since === null) delete next.nitro_since;
        else {
            const since = new Date(body.nitro_since);
            if (Number.isNaN(since.getTime()) || since > now) throw FieldErrors({ nitro_since: { code: "DATE_TYPE_PARSE", message: "Use a date in the past" } });
            next.nitro_since = since.toISOString();
        }
    }
    if (body.void_tier !== undefined) {
        if (body.void_tier === null) delete next.the_void;
        else if (!voidBadgeTier(body.void_tier))
            throw FieldErrors({ void_tier: { code: "BASE_TYPE_CHOICES", message: `Choose one of ${VOID_BADGE_TIERS.map((tier) => tier.key).join(", ")}` } });
        else next.the_void = grantVoidBadge(current.the_void, body.void_tier, now);
    }
    for (const [id, rarity] of Object.entries(body.rarity ?? {})) {
        if (!/^[\w-]{1,64}$/.test(id)) throw FieldErrors({ rarity: { code: "BASE_TYPE_BAD_FORMAT", message: "Badge ids are numbers or badge row ids" } });
        if (rarity === null) delete next.rarity![id];
        else if (BADGE_RARITIES.includes(rarity)) next.rarity![id] = rarity;
        else throw FieldErrors({ rarity: { code: "BASE_TYPE_CHOICES", message: "Rarity is 1, 2, 3 or 5" } });
    }
    if (!Object.keys(next.rarity!).length) delete next.rarity;
    return next;
}

const voidTierName = (grant: BadgeOverrides["the_void"]) => currentVoidGrant(grant)?.tier.name ?? null;

export function voidBadgeChanges(before: BadgeOverrides["the_void"], after: BadgeOverrides["the_void"]) {
    const [old, now] = [voidTierName(before), voidTierName(after)];
    return old === now ? [] : [{ key: VOID_BADGE_ID, old_value: old ?? undefined, new_value: now ?? undefined }];
}

async function describe(userId: string) {
    const user = await User.findOneOrFail({
        where: { id: userId },
        select: { id: true, badge_ids: true, account_preferences: true, created_at: true, badge_overrides: true },
    });
    const overrides = user.badge_overrides ?? {};
    const since = overrides.nitro_since ? new Date(overrides.nitro_since) : null;
    const nitro = since ? nitroProgress(since, new Date()) : null;
    const reached = nitro ? NITRO_TIERS.filter((tier) => nitro.unlocked_at[tier.key]) : [];
    const badges = (await badgeDirectory(user, true)).filter((badge) => badge.owned).map((badge) => ({ id: String(badge.badge_id), name: badge.name, rarity: badge.rarity }));
    const progress = await tieredProgress(user);
    const levels = LEVELLED_BADGES.map((id) => {
        const definition = TIERED_BADGES.find((badge) => badge.id === id)!;
        const reached = progress.get(id);
        const current = reached ? [...definition.tiers].reverse().find((tier) => reached.unlocked_at[tier.key]) : undefined;
        return {
            id: String(id),
            name: definition.name,
            current: current?.key ?? null,
            overridden: id === ACCOUNT_AGE_BADGE ? !!overrides.account_age_since : overrides.progress_offsets?.[id] !== undefined,
            tiers: definition.tiers.map((tier) => ({ key: tier.key, name: tier.name, milestone_text: tier.milestone_text })),
        };
    });
    const voidGrant = currentVoidGrant(overrides.the_void);
    return {
        void_tier: voidGrant?.tier.key ?? null,
        void_granted_at: voidGrant?.granted_at ?? null,
        void_tier_set_at: voidGrant?.tier_set_at ?? null,
        void_tiers: VOID_BADGE_TIERS.map((tier) => ({ key: tier.key, name: tier.name, icon: voidBadgeIcon(tier.key) })),
        nitro_since: overrides.nitro_since ?? null,
        nitro_tier: reached.at(-1)?.key ?? null,
        nitro_tiers: NITRO_TIERS.map((tier) => ({ key: tier.key, name: tier.name, milestone_text: tier.milestone_text, months: tier.threshold })),
        rarity: overrides.rarity ?? {},
        levels,
        badges,
        rarities: [...BADGE_RARITIES],
    };
}

router.get(
    "/",
    route({ right: "VIEW_USERS", spacebarOnly: true, description: "The user's Nitro badge level, The Void level, rarity overrides and badges" }),
    async (req: Request, res: Response) => {
        const target = await adminCustomizationTarget(req);
        res.json(await describe(target.id));
    },
);

router.patch(
    "/",
    route({
        right: "MANAGE_USERS",
        spacebarOnly: true,
        requestBody: "AdminBadgeOverridesSchema",
        description: "Set the user's Nitro badge level or start date, grant, change or remove The Void and override the rarity of their badges",
    }),
    async (req: Request, res: Response) => {
        const target = await adminCustomizationTarget(req, "badges");
        const user = await User.findOneOrFail({ where: { id: target.id }, select: { id: true, badge_overrides: true } });
        const real = activityProgress(await UserActivityStats.findOne({ where: { user_id: target.id } }));
        const next = applyBadgeOverrides(user.badge_overrides ?? {}, req.body as AdminBadgeOverridesSchema, new Date(), real);
        await getDatabase()!.transaction(async (manager) => {
            await manager.update(User, { id: target.id }, { badge_overrides: next });
            await recordAdminCustomization(req, target.id, "badge_overrides", ["badge_overrides"], manager, voidBadgeChanges(user.badge_overrides?.the_void, next.the_void));
        });
        await notifyUserUpdate(target.id);
        await broadcastUserUpdate(target.id);
        res.json(await describe(target.id));
    },
);

export default router;
