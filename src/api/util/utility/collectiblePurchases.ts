import { Badge, CollectiblePurchase, User } from "@spacebar/database";
import { broadcastUserUpdate, CollectibleItemType, Collectibles, DiscordApiErrors, emitEvent, ORB_PROFILE_BADGE_SKU, Snowflake, UserUpdateEvent } from "@spacebar/util";

export const ORBS_APPRENTICE_BADGE_ICON = "83d8a1eb09a8d64e59233eec5d4d5c2d";

export const listCollectiblePurchases = async (user_id: string) => {
    const purchases = await CollectiblePurchase.find({
        where: { user_id },
        order: { purchased_at: "DESC" },
    });
    const owned = await Promise.all(
        purchases.map(async ({ sku_id, purchased_at }) => {
            const product = await Collectibles.product(sku_id);
            if (!product || product.type === CollectibleItemType.BUNDLE || product.type === CollectibleItemType.VARIANTS_GROUP) return undefined;
            return {
                ...product,
                purchased_at: purchased_at.toISOString(),
                purchase_type: 0,
                expires_at: null,
            };
        }),
    );
    return owned.filter((x) => x !== undefined);
};

export const ensureOrbsApprenticeBadge = async () => {
    const existing = await Badge.findOne({ where: { icon: ORBS_APPRENTICE_BADGE_ICON }, order: { id: "ASC" } });
    if (existing) return existing;
    return Badge.create({ id: Snowflake.generate(), description: "Orbs Apprentice", icon: ORBS_APPRENTICE_BADGE_ICON }).save();
};

export const grantOrbsApprenticeBadge = async (user_id: string) => {
    const badge = await ensureOrbsApprenticeBadge();
    const user = await User.findOneOrFail({ where: { id: user_id }, select: { id: true, badge_ids: true } });
    const badges = user.badge_ids ?? [];
    if (badges.includes(badge.id)) return;
    await User.update({ id: user_id }, { badge_ids: [...badges, badge.id] });
    const updated = await User.findOneOrFail({ where: { id: user_id } });
    await emitEvent({ event: "USER_UPDATE", user_id, data: updated.toPrivateUser() as unknown as UserUpdateEvent["data"] } satisfies UserUpdateEvent);
    await broadcastUserUpdate(user_id);
};

export const grantCollectible = async (user_id: string, sku_id: string) => {
    const sku_ids = await Collectibles.grantable(sku_id);
    if (!sku_ids.length) throw DiscordApiErrors.UNKNOWN_SKU;
    const purchased_at = new Date();
    await CollectiblePurchase.createQueryBuilder()
        .insert()
        .values(sku_ids.map((sku) => ({ user_id, sku_id: sku, purchased_at })))
        .orIgnore()
        .execute();
    if (sku_ids.includes(ORB_PROFILE_BADGE_SKU)) await grantOrbsApprenticeBadge(user_id);
    return listCollectiblePurchases(user_id);
};
