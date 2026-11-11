import { EmojiResponse, Snowflake, StickerResponse } from "@spacebar/schemas";

export interface DiscoverableGuildsResponse {
    total: number;
    guilds: DiscoverableGuild[];
    offset: number;
    limit: number;
}

export interface DiscoverableGuild {
    id: Snowflake;
    name: string;
    icon: string | null;
    description: string | null;
    banner: string | null;
    splash: string | null;
    discovery_splash: string | null;
    features: string[];
    vanity_url_code: string | null;
    preferred_locale: string;
    premium_subscription_count: number;
    approximate_member_count: number;
    approximate_presence_count: number;
    emojis?: EmojiResponse[];
    emoji_count?: number;
    stickers?: StickerResponse[];
    sticker_count?: number;
    auto_removed: boolean;
    primary_category_id: number;
    primary_category?: DiscoveryCategory;
    keywords: string[];
    is_published: boolean;
    reasons_to_join?: DiscoveryReason[];
    social_links?: string[];
    about?: string | null;
    category_ids?: Snowflake[];
    categories?: DiscoveryCategory[];
    created_at?: string;
    nsfw_properties?: DiscoveryNsfwProperties | null;
}

export interface DiscoveryCategory {
    id: number;
    name: string;
    is_primary: boolean;
}

export interface DiscoveryReason {
    reason: string;
    emoji_id?: Snowflake;
    emoji_name?: string;
}

export interface DiscoveryNsfwProperties {
    channels?: Snowflake[];
    channel_banned_keywords?: { [id: Snowflake]: string[] };
    name?: string;
    name_banned_keywords?: string[];
    description?: string;
    description_banned_keywords?: string[];
}

export interface DiscoverableGuildsSearchResponse {
    guilds: DiscoverableGuild[];
    total_count: number;
    offset: number;
    limit: number;
    categories?: { id: number; count: number }[];
}
