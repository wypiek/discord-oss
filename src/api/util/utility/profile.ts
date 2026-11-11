import { Member, User } from "@spacebar/database";
import { CollectibleItemType, Collectibles, FieldErrors } from "@spacebar/util";
import { ProfileCollectible } from "@spacebar/schemas";

const SUBSCRIPTION_BADGE = /^(?:premium(?:_|$)|nitro(?:_|$)|subscriber(?:_|$)|guild_booster(?:_|$))/;

export const isSubscriptionBadge = (badge: { id: string; icon: string }) =>
    SUBSCRIPTION_BADGE.test(badge.id) || SUBSCRIPTION_BADGE.test(badge.icon) || badge.icon === "2ba85e8026a8614b640c2837bcdfe21b";

export const profileMetadata = (source: User | Member) => {
    const collectibles = source.profile_collectibles ?? [];
    const effect = collectibles.find((x) => x.type === CollectibleItemType.PROFILE_EFFECT);
    return {
        ...(source instanceof Member ? { guild_id: source.guild_id } : {}),
        bio: source.bio ?? "",
        accent_color: source instanceof User ? (source.accent_color ?? null) : null,
        banner: source.banner ?? null,
        pronouns: source.pronouns ?? "",
        theme_colors: source.theme_colors?.length ? source.theme_colors.map(Number) : null,
        popout_animation_particle_type: null,
        emoji: null,
        profile_effect: effect ? { id: effect.sku_id, expires_at: null } : null,
        collectibles,
    };
};

export const resolveProfileCollectibles = async (current: ProfileCollectible[] | null | undefined, sku_ids?: string[] | null, profile_effect_id?: string | null) => {
    let next = sku_ids === undefined ? [...(current ?? [])] : [];
    for (const sku_id of sku_ids ?? []) {
        const item = (await Collectibles.item(sku_id, CollectibleItemType.PROFILE_EFFECT)) ?? (await Collectibles.item(sku_id, CollectibleItemType.PROFILE_FRAME));
        if (!item) throw FieldErrors({ collectibles_sku_ids: { code: "50057", message: "Invalid SKU" } });
        next = next.filter((x) => x.type !== item.type);
        next.push({ sku_id: item.sku_id, type: item.type, expires_at: null });
    }
    if (profile_effect_id !== undefined) {
        next = next.filter((x) => x.type !== CollectibleItemType.PROFILE_EFFECT);
        if (profile_effect_id) {
            const effect = await Collectibles.item(profile_effect_id, CollectibleItemType.PROFILE_EFFECT);
            if (!effect) throw FieldErrors({ profile_effect_id: { code: "50057", message: "Invalid SKU" } });
            next.push({ sku_id: effect.sku_id, type: effect.type, expires_at: null });
        }
    }
    return next;
};
