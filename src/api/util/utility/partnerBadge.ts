import { Badge, User } from "@spacebar/database";
import { UserFlags } from "@spacebar/schemas";
import { broadcastUserUpdate, emitEvent, LEGACY_BADGES, Snowflake, UserUpdateEvent } from "@spacebar/util";

export const PARTNERED_FEATURE = "PARTNERED";

const PARTNER_BADGE = LEGACY_BADGES.find((badge) => badge.key === "partner")!;
const PARTNER_FLAG = UserFlags.FLAGS.PARTNERED_SERVER_OWNER;

type PartnerState = { owner_id?: string | null; features?: string[] | null };

export const isPartnered = (features?: string[] | null) => features?.includes(PARTNERED_FEATURE) ?? false;

export const partnerBadgeRecipient = (before: PartnerState, after: PartnerState) =>
    after.owner_id && isPartnered(after.features) && (!isPartnered(before.features) || before.owner_id !== after.owner_id) ? after.owner_id : null;

export async function ensurePartnerBadge() {
    const existing = await Badge.findOne({ where: { icon: PARTNER_BADGE.icon }, order: { id: "ASC" } });
    if (existing) return existing;
    return Badge.create({ id: Snowflake.generate(), description: "Partnered Server Owner", icon: PARTNER_BADGE.icon }).save();
}

export async function grantPartnerBadge(user_id: string) {
    const badge = await ensurePartnerBadge();
    const user = await User.findOne({ where: { id: user_id }, select: { id: true, badge_ids: true, public_flags: true, flags: true } });
    if (!user) return false;
    const badges = user.badge_ids ?? [];
    const hasFlag = (BigInt(user.public_flags ?? 0) & PARTNER_FLAG) === PARTNER_FLAG;
    if (badges.includes(badge.id) && hasFlag) return false;
    await User.update(
        { id: user_id },
        {
            badge_ids: badges.includes(badge.id) ? badges : [...badges, badge.id],
            public_flags: Number(BigInt(user.public_flags ?? 0) | PARTNER_FLAG),
            flags: Number(BigInt(user.flags ?? 0) | PARTNER_FLAG),
        },
    );
    const updated = await User.findOneOrFail({ where: { id: user_id } });
    await emitEvent({ event: "USER_UPDATE", user_id, data: updated.toPrivateUser() as unknown as UserUpdateEvent["data"] } satisfies UserUpdateEvent);
    await broadcastUserUpdate(user_id);
    return true;
}

export async function grantPartnerBadgeOnChange(before: PartnerState, after: PartnerState) {
    const recipient = partnerBadgeRecipient(before, after);
    if (recipient) await grantPartnerBadge(recipient);
}
