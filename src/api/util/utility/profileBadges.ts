import { User } from "@spacebar/database";
import { Config, DiscordApiErrors } from "@spacebar/util";
import { arrangeBadges, badgeSettings, isStaffBadge } from "./badgeSettings";
import { localProfileBadges } from "./remoteBadges";

export const DIRECTORY_STAFF_BADGE_ID = 22;

type ProfileBadge = Awaited<ReturnType<typeof localProfileBadges>>[number];
type BadgeOwner = Pick<User, "id" | "badge_ids" | "federated_instance" | "pride_badges" | "account_preferences">;

const iconUrl = (icon: string) => `${(Config.get().cdn.endpointPublic || Config.get().api.endpointPublic || "").replace(/\/$/, "")}/badge-icons/${icon}.png`;

export const directoryBadge = (badge: ProfileBadge, hidden: boolean) => ({
    badge_id: isStaffBadge(badge) ? DIRECTORY_STAFF_BADGE_ID : badge.id,
    name: badge.description,
    description: badge.description,
    owned: true,
    hidden,
    is_earnable: false,
    simple_icon_url: iconUrl(badge.icon),
    simple_icon_raster_url: iconUrl(badge.icon),
    link: badge.link ?? null,
    tiers: [],
    current_tier: null,
    next_tier: null,
    requirements: [],
    progress: [],
    obtained_at: null,
    tier_obtained_at: null,
});

export async function badgeDirectory(user: BadgeOwner, includeHidden: boolean) {
    const { visible, hidden } = arrangeBadges(await localProfileBadges(user), badgeSettings(user));
    return [...visible.map((badge) => directoryBadge(badge, false)), ...(includeHidden ? hidden.map((badge) => directoryBadge(badge, true)) : [])];
}

export async function loadBadgeOwner(userId: string, viewerId: string) {
    const id = userId === "@me" ? viewerId : userId;
    if (!/^\d{1,20}$/.test(id)) throw DiscordApiErrors.UNKNOWN_USER;
    const user = await User.findOne({
        where: { id },
        select: { id: true, badge_ids: true, federated_instance: true, pride_badges: true, account_preferences: true },
    });
    if (!user) throw DiscordApiErrors.UNKNOWN_USER;
    return { user, self: user.id === viewerId };
}
