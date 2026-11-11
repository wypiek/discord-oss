import { PRIDE_BADGE_CATALOG, PRIDE_BADGES } from "@spacebar/api/util/utility/prideBadges";
import { Config } from "@spacebar/util";

export const isPrideBadgeSelection = (flags: unknown): flags is string[] =>
    Array.isArray(flags) && flags.length <= PRIDE_BADGES.length && flags.every((slug) => typeof slug === "string" && PRIDE_BADGES.some((badge) => badge.slug === slug));

export const publicPrideBadges = () => {
    const cdn = (Config.get().cdn.endpointPublic || "").replace(/\/+$/, "");
    return {
        max_selections: PRIDE_BADGES.length,
        badges: PRIDE_BADGE_CATALOG.map(({ slug, id, description, icon, source, aliases }) => ({
            slug,
            id,
            description,
            aliases,
            icon_url: `${cdn}/badge-icons/${icon}.png`,
            source,
        })),
    };
};
